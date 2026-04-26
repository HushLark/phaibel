// ─────────────────────────────────────────────────────────────────────────────
// CXF Serializer — converts Phaibel entities to a CXF/2 JSON-LD document.
// No LLM involvement. Transport layer only — protocol is unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import type { IndexNode } from '../entities/entity-index.js';
import type { EntityTypeConfig, FieldDef } from '../entities/entity-type-config.js';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface CxfExportOpts {
    vaultId: string;
    ownerName: string;
    ownerEmail: string;
    exportTime: number;        // Unix seconds
    includeSchema: boolean;
    includeGraph: boolean;
    includeArchived: boolean;
}

export interface CxfTombstone {
    entityId: string;
    vaultId: string;
    type: 'deleted' | 'archived';
    title: string;
    updatedAtUnix: number;
}

export interface SerializeResult {
    document: string;
    entityCount: number;
    schemaCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON-LD CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

const CONTEXT = {
    cxf: 'https://cxf.phaibel.ai/ns/',
    schema: 'https://schema.org/',
};

// ─────────────────────────────────────────────────────────────────────────────
// TYPE ROUTING
// ─────────────────────────────────────────────────────────────────────────────

function jsonldType(phaibelType: string): string {
    if (phaibelType === 'event') return 'cxf:Event';
    if (phaibelType === 'note') return 'cxf:Note';
    if (phaibelType === 'task' || phaibelType === 'goal' || phaibelType === 'todont') return 'cxf:Task';
    return 'cxf:Context';
}

// ─────────────────────────────────────────────────────────────────────────────
// LINK HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function roleFromLabel(label: string): string {
    const chair = ['assigned-to', 'owner', 'responsible'];
    const opt = ['attendee', 'invited'];
    const none = ['observer', 'cc', 'notify'];
    if (chair.includes(label)) return 'CHAIR';
    if (opt.includes(label)) return 'OPT-PARTICIPANT';
    if (none.includes(label)) return 'NON-PARTICIPANT';
    return 'REQ-PARTICIPANT';
}

interface EntityLink { target: string; label: string; }

function extractLinks(meta: Record<string, unknown>): EntityLink[] {
    const raw = meta.links;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
        (l): l is EntityLink =>
            l && typeof l === 'object' && typeof l.target === 'string' && typeof l.label === 'string',
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA BUILDER
// ─────────────────────────────────────────────────────────────────────────────

function fieldTypeToCxf(f: FieldDef): string {
    const map: Record<string, string> = {
        string: 'text', number: 'number', boolean: 'boolean',
        date: 'date', datetime: 'datetime', duration: 'duration', time: 'time',
        'date-fixed': 'date-fixed', 'date-floating': 'date-floating',
        reference: 'reference',
        enum: 'enum', array: 'array', object: 'object',
    };
    return map[f.type] ?? 'text';
}

function buildSchema(typeConfig: EntityTypeConfig): Record<string, unknown> {
    const schema: Record<string, unknown> = {
        '@type': 'cxf:TypeSchema',
        'cxf:typeName': typeConfig.name,
        'cxf:plural': typeConfig.plural,
    };
    if (typeConfig.description) schema['cxf:description'] = typeConfig.description;
    schema['cxf:fields'] = typeConfig.fields.map(f => {
        const fd: Record<string, unknown> = {
            'cxf:key': f.key,
            'cxf:type': fieldTypeToCxf(f),
            'cxf:label': f.label ?? f.key,
        };
        if (f.required) fd['cxf:required'] = true;
        if (f.values?.length) fd['cxf:values'] = f.values;
        if (f.targetType) fd['cxf:targetType'] = f.targetType;
        return fd;
    });
    return schema;
}

// ─────────────────────────────────────────────────────────────────────────────
// NODE BUILDER
// ─────────────────────────────────────────────────────────────────────────────

// Fields already mapped to top-level schema.org or cxf: properties — skip in cxf:fields
const MAPPED_KEYS = new Set([
    'id', 'title', 'entityType', 'created', 'updated', 'tags', 'summary', 'body', 'links', 'archivedAt',
    'startDate', 'endDate', 'dueDate', 'duration', 'location', 'status', 'priority',
]);

function buildNode(
    node: IndexNode,
    opts: CxfExportOpts,
    nodesByKey: Map<string, IndexNode>,
    archived: boolean,
    deleted: boolean,
    typeConfig?: EntityTypeConfig,
): Record<string, unknown> {
    const m = node.meta as Record<string, unknown>;

    const out: Record<string, unknown> = {
        '@id': `urn:cxf:${opts.vaultId}:${node.id}`,
        '@type': jsonldType(node.type),
        'schema:name': node.title,
        'cxf:nativeType': node.type,
    };

    if (m.body) out['schema:description'] = String(m.body);
    if (m.startDate) out['schema:startDate'] = String(m.startDate);
    if (m.endDate) out['schema:endDate'] = String(m.endDate);
    if (m.dueDate) out['schema:dueDate'] = String(m.dueDate);
    if (m.duration) out['schema:duration'] = String(m.duration);
    if (m.location) out['schema:location'] = String(m.location);
    if (m.status) out['cxf:status'] = String(m.status);
    if (m.priority) out['cxf:priority'] = String(m.priority);
    if (m.created) out['schema:dateCreated'] = String(m.created);
    const updated = m.updated ?? m.created;
    if (updated) out['schema:dateModified'] = String(updated);
    if (node.tags.length) out['schema:keywords'] = node.tags;

    out['cxf:archived'] = archived;
    out['cxf:deleted'] = deleted;

    if (opts.includeGraph) {
        const links = extractLinks(m);

        const personLinks = links.filter(l => l.target.startsWith('person:'));
        if (personLinks.length) {
            out['cxf:attendees'] = personLinks.map(l => {
                const personNode = nodesByKey.get(l.target);
                const personId = l.target.replace('person:', '');
                return {
                    'cxf:personId': personId,
                    'cxf:role': roleFromLabel(l.label),
                    'schema:name': personNode?.title ?? personId,
                    'schema:email': (personNode?.meta?.email as string | undefined) ?? `${personId}@cxf.local`,
                };
            });
        }

        const entityLinks = links.filter(l => !l.target.startsWith('person:'));
        if (entityLinks.length) {
            out['cxf:links'] = entityLinks.map(l => ({
                'cxf:label': l.label,
                'cxf:target': `urn:cxf:${opts.vaultId}:${l.target}`,
            }));
        }
    }

    // Custom fields — everything not already mapped to a top-level property
    const specialFieldKeys = new Set(
        (typeConfig?.fields ?? [])
            .filter(f => ['reference', 'date-fixed', 'date-floating', 'time'].includes(f.type))
            .map(f => f.key),
    );

    const customFields: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(m)) {
        if (MAPPED_KEYS.has(k) || v === undefined || v === null || v === '') continue;
        if (specialFieldKeys.has(k)) continue;
        customFields[k] = v;
    }

    // Special-typed fields (reference, date-fixed, date-floating, time)
    if (typeConfig) {
        for (const f of typeConfig.fields) {
            const v = m[f.key];
            if (v === undefined || v === null || v === '') continue;
            if (f.type === 'reference' && f.targetType !== 'person') {
                customFields[f.key] = `urn:cxf:${opts.vaultId}:${String(v)}`;
            } else if (f.type === 'date-fixed' || f.type === 'date-floating' || f.type === 'time') {
                customFields[f.key] = String(v);
            }
        }
    }

    if (Object.keys(customFields).length) out['cxf:fields'] = customFields;

    return out;
}

function buildTombstoneNode(t: CxfTombstone, opts: CxfExportOpts): Record<string, unknown> {
    return {
        '@id': `urn:cxf:${opts.vaultId}:${t.entityId}`,
        '@type': 'cxf:Context',
        'schema:name': t.title,
        'cxf:nativeType': 'tombstone',
        'schema:dateModified': new Date(t.updatedAtUnix * 1000).toISOString(),
        'cxf:archived': t.type === 'archived',
        'cxf:deleted': t.type === 'deleted',
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export function serializeToCxf(
    nodes: IndexNode[],
    entityTypes: EntityTypeConfig[],
    tombstones: CxfTombstone[],
    opts: CxfExportOpts,
): SerializeResult {
    const nodesByKey = new Map<string, IndexNode>();
    for (const n of nodes) nodesByKey.set(`${n.type}:${n.id}`, n);

    const typeNames = new Set(nodes.map(n => n.type));
    const typeConfigByName = new Map(entityTypes.map(t => [t.name, t]));

    const schemasToEmit = opts.includeSchema
        ? entityTypes.filter(t => typeNames.has(t.name))
        : [];

    const graph: Record<string, unknown>[] = [];
    let includedCount = 0;

    for (const node of nodes) {
        const archived = !!(node.meta.archivedAt as string | undefined);
        if (archived && !opts.includeArchived) continue;
        includedCount++;
        const tc = typeConfigByName.get(node.type);
        graph.push(buildNode(node, opts, nodesByKey, archived, false, tc));
    }

    for (const t of tombstones) {
        includedCount++;
        graph.push(buildTombstoneNode(t, opts));
    }

    const doc: Record<string, unknown> = {
        '@context': CONTEXT,
        'cxf:version': '2',
        'cxf:vaultId': opts.vaultId,
        'cxf:exportTime': opts.exportTime,
        'cxf:ownerName': opts.ownerName,
        'cxf:ownerEmail': opts.ownerEmail,
    };

    if (schemasToEmit.length) {
        doc['cxf:schemas'] = schemasToEmit.map(buildSchema);
    }

    doc['@graph'] = graph;

    return {
        document: JSON.stringify(doc, null, 2),
        entityCount: includedCount,
        schemaCount: schemasToEmit.length,
    };
}
