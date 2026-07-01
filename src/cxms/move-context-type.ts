// ─────────────────────────────────────────────────────────────────────────────
// Move a CxMS node from one context type to another (e.g. person → family).
//
// This is NOT a file move. Reclassifying a node must:
//   1. Reconcile the node's fields against the TARGET type's schema (carry
//      compatible fields, apply caller-provided/mapped values, defaults, validate).
//   2. Re-derive the relevance layers: recompute meta.dimensions for the new type,
//      and flag when the target's (possibly inherited) dimension config reads a
//      field the node won't have — e.g. person's socialProximity{field:'type'} vs
//      family's `relationship` — which would silently blank that layer.
//   3. Relocate the file to the target type's directory.
//   4. Preserve referential integrity: re-key the node (type:id) and rewrite every
//      inbound link across the vault from `${from}:${id}` → `${to}:${id}`.
//   5. Re-key the entity + embedding indexes.
//
// `previewMoveContextType` reports the plan (field mapping, missing required
// fields, relevance warnings, inbound-link count) WITHOUT writing — so the caller
// can infer required values and confirm before `moveContextType` applies.
// ─────────────────────────────────────────────────────────────────────────────

import { join } from 'path';
import {
    listEntities, writeEntity, trashEntity, ensureEntityDir, getEntityDir,
    nodeFilename, type EntityTypeName,
} from '../entities/entity.js';
import { getEntityType, loadEntityTypes, type EntityTypeConfig, type FieldDef } from '../entities/entity-type-config.js';
import { validateEntity } from '../entities/entity-validator.js';
import { computeNodeDimensions } from './dimension-calculator.js';
import { resolveDomainDimensions } from '../entities/base-categories.js';
import { getEntityIndex } from '../entities/entity-index.js';
import { debug } from '../utils/debug.js';

interface EntityLink { target: string; label: string }

// Non-domain keys handled specially (never treated as reconcilable fields).
const NON_DOMAIN = new Set([
    'id', 'entityType', 'contextType', 'name', 'title', 'description', 'summary',
    'created', 'updated', 'dimensions', 'links', 'source', 'sourceId', '_filepath',
]);

export interface MoveFieldPlan {
    carried: Record<string, unknown>;                  // same-key fields kept
    provided: Record<string, unknown>;                 // caller-supplied (fieldMap) values
    defaulted: Record<string, unknown>;                // target defaults applied
    dropped: { key: string; value: unknown }[];        // source fields with no home in target
    missingRequired: { key: string; label?: string; values?: string[] }[]; // still unsatisfied
}

export interface MovePreview {
    nodeId: string;
    title: string;
    fromType: string;
    toType: string;
    fields: MoveFieldPlan;
    relevanceWarnings: string[];   // dimension configs reading fields the node won't have
    inboundLinks: number;          // # of vault nodes linking to this node (will be re-pointed)
    ready: boolean;                // true when no required fields are missing
}

interface FoundNode { filepath: string; meta: Record<string, unknown>; content: string }

async function findNode(type: string, id: string): Promise<FoundNode | null> {
    const rows = await listEntities(type as EntityTypeName).catch(() => []);
    return rows.find(r => r.meta.id === id) ?? null;
}

// Build the field-reconciliation plan for moving `node` into `toType`.
function planFields(
    node: FoundNode, toType: EntityTypeConfig, fieldMap: Record<string, unknown>,
): MoveFieldPlan {
    const targetKeys = new Set((toType.fields ?? []).map(f => f.key));
    const carried: Record<string, unknown> = {};
    const provided: Record<string, unknown> = {};
    const defaulted: Record<string, unknown> = {};
    const dropped: { key: string; value: unknown }[] = [];

    // 1. Carry same-key domain fields the target also declares.
    for (const [k, v] of Object.entries(node.meta)) {
        if (NON_DOMAIN.has(k)) continue;
        if (targetKeys.has(k)) carried[k] = v;
        else dropped.push({ key: k, value: v });
    }
    // 2. Caller-supplied values (mapped/inferred) win over carried.
    for (const [k, v] of Object.entries(fieldMap)) {
        if (targetKeys.has(k) && v !== undefined && v !== null && v !== '') provided[k] = v;
    }
    // 3. Apply defaults for required fields still unset; collect what's still missing.
    const value = (k: string) => provided[k] ?? carried[k];
    const missingRequired: MoveFieldPlan['missingRequired'] = [];
    for (const f of toType.fields ?? []) {
        if (!f.required) continue;
        if (value(f.key) !== undefined) continue;
        if (f.default !== undefined) { defaulted[f.key] = f.default; continue; }
        missingRequired.push({ key: f.key, label: f.label, values: (f as FieldDef & { values?: string[] }).values });
    }
    return { carried, provided, defaulted, dropped, missingRequired };
}

// Flag relevance layers that will go dark: a dimension whose configured `field`
// won't be present on the reclassified node.
function relevanceWarnings(
    finalMeta: Record<string, unknown>, toType: EntityTypeConfig, byName: Map<string, EntityTypeConfig>,
): string[] {
    const dims = resolveDomainDimensions(toType, byName);
    const warnings: string[] = [];
    for (const d of dims) {
        const field = (d.config as { field?: string; coordinatesField?: string; startField?: string } | undefined);
        const key = field?.field ?? field?.coordinatesField ?? field?.startField;
        if (key && finalMeta[key] === undefined) {
            warnings.push(`relevance layer "${d.type}" reads field "${key}", which the moved node won't have — that signal will be inactive for ${toType.name}`);
        }
    }
    return warnings;
}

async function buildFinalMeta(
    node: FoundNode, toType: EntityTypeConfig, plan: MoveFieldPlan,
): Promise<Record<string, unknown>> {
    const meta: Record<string, unknown> = {
        id: node.meta.id,
        contextType: toType.name,
        name: node.meta.name ?? node.meta.title,
        description: node.meta.description ?? node.meta.summary,
        created: node.meta.created,
        updated: new Date().toISOString(),
        ...plan.carried,
        ...plan.provided,
        ...plan.defaulted,
    };
    if (node.meta.links) meta.links = node.meta.links;   // outbound links unchanged
    meta.dimensions = computeNodeDimensions(meta, toType);
    return meta;
}

/** Read-only: report the reconciliation + relevance plan for a move. */
export async function previewMoveContextType(
    nodeId: string, fromType: string, toType: string, fieldMap: Record<string, unknown> = {},
): Promise<MovePreview> {
    const [toCfg, types] = await Promise.all([getEntityType(toType), loadEntityTypes()]);
    if (!toCfg) throw new Error(`Target context type not found: ${toType}`);
    const node = await findNode(fromType, nodeId);
    if (!node) throw new Error(`Node ${fromType}:${nodeId} not found`);

    const plan = planFields(node, toCfg, fieldMap);
    const finalMeta = await buildFinalMeta(node, toCfg, plan);
    const byName = new Map(types.map(t => [t.name, t]));

    // Count inbound links across the vault.
    const fromKey = `${fromType}:${nodeId}`;
    let inbound = 0;
    for (const t of types) {
        const rows = await listEntities(t.name as EntityTypeName, { metaOnly: true }).catch(() => []);
        for (const r of rows) {
            const links = (r.meta.links as EntityLink[] | undefined) ?? [];
            if (links.some(l => l.target === fromKey)) inbound++;
        }
    }

    return {
        nodeId, title: String(node.meta.name ?? node.meta.title ?? nodeId),
        fromType, toType,
        fields: plan,
        relevanceWarnings: relevanceWarnings(finalMeta, toCfg, byName),
        inboundLinks: inbound,
        ready: plan.missingRequired.length === 0,
    };
}

export interface MoveResult {
    ok: boolean;
    nodeId: string; fromType: string; toType: string;
    newFilepath?: string;
    inboundRewritten: number;
    droppedFields: string[];
    relevanceWarnings: string[];
    message?: string;
}

/**
 * Apply the move. Requires all target required fields satisfied (via fieldMap,
 * carried values, or defaults) — otherwise returns { ok:false } with the plan.
 * Set `force` to move anyway (missing required fields left unset).
 */
export async function moveContextType(
    nodeId: string, fromType: string, toType: string,
    opts: { fieldMap?: Record<string, unknown>; force?: boolean } = {},
): Promise<MoveResult> {
    const fieldMap = opts.fieldMap ?? {};
    const [toCfg, types] = await Promise.all([getEntityType(toType), loadEntityTypes()]);
    if (!toCfg) return fail('Target context type not found: ' + toType);
    const node = await findNode(fromType, nodeId);
    if (!node) return fail(`Node ${fromType}:${nodeId} not found`);

    const plan = planFields(node, toCfg, fieldMap);
    if (plan.missingRequired.length > 0 && !opts.force) {
        return { ...fail(`Missing required fields: ${plan.missingRequired.map(m => m.key).join(', ')}`),
            droppedFields: plan.dropped.map(d => d.key) };
    }

    const finalMeta = await buildFinalMeta(node, toCfg, plan);
    const errors = validateEntity(finalMeta, toCfg, true);
    if (errors.length > 0 && !opts.force) {
        return fail(`Validation failed: ${errors.map(e => `${e.field} ${e.message}`).join('; ')}`);
    }

    // Write into the target type's directory, then trash the old file.
    const dir = await ensureEntityDir(toType as EntityTypeName);
    const newFilepath = join(dir, nodeFilename(String(finalMeta.name ?? nodeId), nodeId));
    await writeEntity(newFilepath, finalMeta, node.content ?? '');
    if (node.filepath !== newFilepath) await trashEntity(node.filepath).catch(() => {});

    // Re-key the indexes: entity index (rescans edges) + embedding index.
    const index = getEntityIndex();
    try { index.remove(fromType as EntityTypeName, nodeId); } catch { /* not indexed */ }
    await index.addOrUpdate(toType as EntityTypeName, nodeId, String(finalMeta.name ?? nodeId),
        newFilepath, finalMeta.description as string | undefined).catch(() => {});
    try {
        const { getEmbeddingIndex } = await import('../entities/embedding-index.js');
        const emb = getEmbeddingIndex();
        emb.remove(`${fromType}:${nodeId}`);
        await emb.upsert(`${toType}:${nodeId}`, {
            title: String(finalMeta.name ?? nodeId),
            summary: String(finalMeta.description ?? ''),
            bodySnippet: (node.content ?? '').slice(0, 500),
        }).catch(() => {});
    } catch { /* embeddings optional */ }

    // Rewrite inbound links across the vault: ${from}:${id} → ${to}:${id}.
    const fromKey = `${fromType}:${nodeId}`;
    const toKey = `${toType}:${nodeId}`;
    let rewritten = 0;
    for (const t of types) {
        const rows = await listEntities(t.name as EntityTypeName).catch(() => []);
        for (const r of rows) {
            const links = (r.meta.links as EntityLink[] | undefined) ?? [];
            if (!links.some(l => l.target === fromKey)) continue;
            r.meta.links = links.map(l => l.target === fromKey ? { ...l, target: toKey } : l);
            await writeEntity(r.filepath, r.meta, r.content);
            await index.addOrUpdate(t.name as EntityTypeName, String(r.meta.id), String(r.meta.name ?? r.meta.title ?? r.meta.id),
                r.filepath, r.meta.description as string | undefined).catch(() => {});
            rewritten++;
        }
    }

    const byName = new Map(types.map(t => [t.name, t]));
    debug('cxms', `moved ${fromKey} → ${toKey}: ${rewritten} inbound links rewritten, ${plan.dropped.length} fields dropped`);
    return {
        ok: true, nodeId, fromType, toType, newFilepath,
        inboundRewritten: rewritten,
        droppedFields: plan.dropped.map(d => d.key),
        relevanceWarnings: relevanceWarnings(finalMeta, toCfg, byName),
    };

    function fail(message: string): MoveResult {
        return { ok: false, nodeId, fromType, toType, inboundRewritten: 0, droppedFields: [], relevanceWarnings: [], message };
    }
}
