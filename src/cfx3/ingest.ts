// ─────────────────────────────────────────────────────────────────────────────
// CF/x3 → CxMS ingest — the federated-context persistence layer.
//
// This is the piece prior federation attempts (CXF, FCP) never had: it MIRRORS
// remote Cfx3Nodes into the local CxMS as real entity files, idempotently, keyed
// on (meta.source, meta.sourceId) so re-pulls upsert instead of duplicating. It
// applies the normal CxMS rules on write (type validation + relevance dimensions)
// and honors the reserved `meta.sourceId` so progressive-interview won't pester
// the user to fill in externally-synced fields.
// ─────────────────────────────────────────────────────────────────────────────

import { join } from 'path';
import {
    listEntities, writeEntity, trashEntity, generateNodeId, ensureEntityDir, nodeFilename,
    type EntityTypeName,
} from '../entities/entity.js';
import { getEntityType, addEntityType, type EntityTypeConfig, type FieldType } from '../entities/entity-type-config.js';
import { validateEntity } from '../entities/entity-validator.js';
import { computeNodeDimensions } from '../cxms/dimension-calculator.js';
import { debug } from '../utils/debug.js';
import type { Cfx3Manifest, Cfx3Node } from './protocol.js';

const FIELD_TYPES: ReadonlySet<string> = new Set([
    'string', 'number', 'boolean', 'date', 'datetime', 'duration', 'time',
    'date-fixed', 'date-floating', 'reference', 'enum', 'array', 'object',
]);
function mapFieldType(t: string): FieldType {
    return (FIELD_TYPES.has(t) ? t : 'string') as FieldType;
}

/**
 * Ensure a CxMS context type exists for every type the source manifest declares,
 * so ingested records land in a real, validated type. Idempotent.
 */
export async function ensureTypesFromManifest(manifest: Cfx3Manifest): Promise<void> {
    // Create parents before children so the `parent` subtype link resolves and the
    // local type tree mirrors the source's hierarchy (spec §3.2.2).
    for (const t of orderByParent(manifest.context_types)) {
        if (await getEntityType(t.name)) continue;
        // Build configs WITHOUT undefined-valued keys — they're persisted to the
        // type's .cxms.md via YAML, and js-yaml throws on `undefined` values.
        const config: EntityTypeConfig = {
            name: t.name,
            plural: t.plural || `${t.name}s`,
            directory: `context-types/${t.name}`,
            fields: (t.fields ?? []).map(f => {
                const field: Record<string, unknown> = {
                    key: f.key, type: mapFieldType(f.type), required: false,
                };
                if (f.label !== undefined) field.label = f.label;
                if (f.values !== undefined) field.values = f.values;
                if (f.targetType !== undefined) field.targetType = f.targetType;
                return field as unknown as EntityTypeConfig['fields'][number];
            }),
        };
        if (t.description !== undefined) config.description = t.description;
        if (t.baseCategory !== undefined) config.baseCategory = t.baseCategory;
        if (t.parent !== undefined) config.parent = t.parent;   // preserve the subtype tree
        try {
            await addEntityType(config);
            debug('cfx3', `ensured context type '${t.name}' from manifest`);
        } catch (e) {
            debug('cfx3', `ensure type '${t.name}' failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
}

/**
 * Topologically order types so a parent precedes its children. Tolerates dangling
 * parents and cycles (falls back to leaving the node where it is).
 */
function orderByParent(types: Cfx3Manifest['context_types']): Cfx3Manifest['context_types'] {
    const byName = new Map(types.map(t => [t.name, t]));
    const ordered: Cfx3Manifest['context_types'] = [];
    const placed = new Set<string>();
    const visit = (t: Cfx3Manifest['context_types'][number], stack: Set<string>) => {
        if (placed.has(t.name) || stack.has(t.name)) return;
        stack.add(t.name);
        if (t.parent && byName.has(t.parent)) visit(byName.get(t.parent)!, stack);
        stack.delete(t.name);
        if (!placed.has(t.name)) { ordered.push(t); placed.add(t.name); }
    };
    for (const t of types) visit(t, new Set());
    return ordered;
}

export interface IngestResult { created: number; updated: number; deleted: number; skipped: number; }

/**
 * Upsert CF/x3 records into CxMS, keyed on (source, sourceId=uid). Returns counts.
 * `sourceId` is the CF/x3 source id (e.g. 'synaptic'); record.uid is the remote id.
 */
export async function ingestRecords(
    sourceId: string, records: Cfx3Node[], tombstones: string[] = [],
): Promise<IngestResult> {
    const result: IngestResult = { created: 0, updated: 0, deleted: 0, skipped: 0 };

    // Build a (uid → existing file) index for this source across all touched types.
    const types = [...new Set(records.map(r => r.type))];
    const existingByUid = new Map<string, { filepath: string; meta: Record<string, unknown>; content: string; type: string }>();
    for (const type of types) {
        let rows: { filepath: string; meta: Record<string, unknown>; content: string }[];
        try {
            rows = await listEntities(type as EntityTypeName);
        } catch {
            continue;
        }
        for (const row of rows) {
            if (row.meta.source === sourceId && typeof row.meta.sourceId === 'string') {
                existingByUid.set(String(row.meta.sourceId), { ...row, type });
            }
        }
    }

    for (const rec of records) {
        if (rec.deleted) {
            const ex = existingByUid.get(rec.uid);
            if (ex) { await trashEntity(ex.filepath).catch(() => {}); result.deleted++; }
            continue;
        }
        const typeConfig = await getEntityType(rec.type);
        if (!typeConfig) { result.skipped++; continue; } // unknown type (manifest not synced)

        const existing = existingByUid.get(rec.uid);
        const now = new Date().toISOString();
        const meta: Record<string, unknown> = {
            ...(existing?.meta ?? {}),
            // Remote field values first, so they can NEVER clobber the reserved
            // core/provenance keys below (e.g. a CRM "source" field vs. the CF/x3
            // provenance "source"). Provenance must win for scoping & dedup.
            ...(rec.fields ?? {}),
            id: (existing?.meta.id as string) ?? generateNodeId(),
            title: rec.title,
            contextType: rec.type,
            source: sourceId,
            sourceId: rec.uid,
            created: (existing?.meta.created as string) ?? now,
            updated: rec.updated || now,
        };
        if (rec.links?.length) {
            // Remote uid targets are resolved to local nodes once both are ingested.
            meta.links = rec.links.map(l => ({ label: l.label, target: resolveLinkTarget(l.target, sourceId, existingByUid) }));
        }

        // Apply CxMS rules: validate against the type, compute relevance dimensions.
        const errors = validateEntity(meta, typeConfig, !existing);
        if (errors.length) {
            debug('cfx3', `validation skip ${rec.uid}: ${errors.map(e => `${e.field} ${e.message}`).join('; ')}`);
            result.skipped++; continue;
        }
        if (typeConfig.dimensions?.length) meta.dimensions = computeNodeDimensions(meta, typeConfig);

        const body = rec.body ?? (rec.summary ? rec.summary : '');
        if (existing) {
            await writeEntity(existing.filepath, meta, existing.content || body);
            result.updated++;
        } else {
            const dir = await ensureEntityDir(rec.type as EntityTypeName);
            await writeEntity(join(dir, nodeFilename(rec.title, meta.id as string)), meta, body);
            result.created++;
        }
    }

    // Explicit tombstones (uids deleted since last sync).
    for (const uid of tombstones) {
        const ex = existingByUid.get(uid);
        if (ex) { await trashEntity(ex.filepath).catch(() => {}); result.deleted++; }
    }

    debug('cfx3', `ingest ${sourceId}: +${result.created} ~${result.updated} -${result.deleted} (skipped ${result.skipped})`);
    return result;
}

// Map a remote uid link target to a local node ref when we already have that node
// ingested from the same source; otherwise keep the remote uid (resolves on a
// later pass once the target is synced).
function resolveLinkTarget(
    remoteUid: string, _sourceId: string,
    existingByUid: Map<string, { meta: Record<string, unknown>; type: string }>,
): string {
    const ex = existingByUid.get(remoteUid);
    return ex ? `${ex.type}:${ex.meta.id}` : remoteUid;
}
