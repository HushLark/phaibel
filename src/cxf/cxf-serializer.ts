// ─────────────────────────────────────────────────────────────────────────────
// CXF Serializer — converts Phaibel entities to a CXF/1 document.
// No LLM involvement. Implements CXF-SPEC.md §4–§8.
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

// ─────────────────────────────────────────────────────────────────────────────
// LINE FOLDING (RFC 5545 §3.1)
// ─────────────────────────────────────────────────────────────────────────────

function foldLine(line: string): string {
    const LIMIT = 75;
    if (Buffer.byteLength(line, 'utf8') <= LIMIT) return line;
    const parts: string[] = [];
    let current = '';
    for (const char of line) {
        if (Buffer.byteLength(current + char, 'utf8') > LIMIT) {
            parts.push(current);
            current = ' ' + char;
        } else {
            current += char;
        }
    }
    if (current) parts.push(current);
    return parts.join('\r\n');
}

function prop(name: string, value: string): string {
    if (!value && value !== '0') return '';
    return foldLine(`${name}:${value}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// DATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function toIcsDate(iso: string): string {
    // Returns YYYYMMDD for date-only, or YYYYMMDDTHHmmssZ for datetime
    if (!iso) return '';
    const d = iso.replace(/[-:]/g, '').replace('T', 'T').split('.')[0];
    if (iso.length <= 10) return d.slice(0, 8);
    return d.endsWith('Z') ? d : d + 'Z';
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS / PRIORITY MAPPING
// ─────────────────────────────────────────────────────────────────────────────

function mapStatus(status: string | undefined, type: string): { icsStatus: string; ext: string } {
    if (type === 'todont') {
        const map: Record<string, string> = {
            'open': 'NEEDS-ACTION', 'in-progress': 'IN-PROCESS',
            'done': 'COMPLETED', 'blocked': 'IN-PROCESS', 'cancelled': 'CANCELLED',
        };
        return { icsStatus: map[status ?? 'in-progress'] ?? 'IN-PROCESS', ext: status === 'blocked' ? 'blocked' : '' };
    }
    const map: Record<string, string> = {
        'open': 'NEEDS-ACTION', 'in-progress': 'IN-PROCESS',
        'done': 'COMPLETED', 'blocked': 'IN-PROCESS',
        'active': 'IN-PROCESS', 'completed': 'COMPLETED',
        'paused': 'IN-PROCESS', 'abandoned': 'CANCELLED',
    };
    const ext = status === 'blocked' ? 'blocked' : status === 'paused' ? 'paused' : '';
    return { icsStatus: map[status ?? 'open'] ?? 'NEEDS-ACTION', ext };
}

function mapPriority(priority: string | undefined): string {
    const map: Record<string, string> = { critical: '1', high: '3', medium: '5', low: '9' };
    return map[priority ?? ''] ?? '0';
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

function buildAttendeeLines(
    links: EntityLink[],
    nodesByKey: Map<string, IndexNode>,
    vaultId: string,
): string {
    return links
        .filter(l => l.target.startsWith('person:'))
        .map(l => {
            const personNode = nodesByKey.get(l.target);
            const personId = l.target.replace('person:', '');
            const name = personNode?.title ?? personId;
            const email = (personNode?.meta?.email as string | undefined) ?? `${personId}@cxf.local`;
            const role = roleFromLabel(l.label);
            return foldLine(
                `ATTENDEE;CN=${name};ROLE=${role};PARTSTAT=NEEDS-ACTION;X-CXF-PERSON-ID=${personId}:mailto:${email}`
            );
        })
        .filter(Boolean)
        .join('\r\n');
}

function buildLinkLines(links: EntityLink[], vaultId: string): string {
    return links
        .filter(l => !l.target.startsWith('person:'))
        .map(l => foldLine(`X-CXF-LINK;LABEL=${l.label};EDGE=link:${l.target}@${vaultId}`))
        .join('\r\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// VSCHEMA
// ─────────────────────────────────────────────────────────────────────────────

function fieldTypeToCxf(f: FieldDef): string {
    const map: Record<string, string> = {
        string: 'TEXT', number: 'NUMBER', boolean: 'BOOLEAN',
        date: 'DATE', datetime: 'DATETIME', duration: 'DURATION',
        enum: 'ENUM', array: 'ARRAY', object: 'OBJECT',
    };
    return map[f.type] ?? 'TEXT';
}

function buildVSchema(typeConfig: EntityTypeConfig): string {
    const lines: string[] = [
        'BEGIN:VSCHEMA',
        prop('X-CXF-TYPE-NAME', typeConfig.name),
        prop('X-CXF-PLURAL', typeConfig.plural),
        typeConfig.description ? prop('X-CXF-DESCRIPTION', typeConfig.description.replace(/\n/g, '\\n')) : '',
    ];
    for (const f of typeConfig.fields) {
        const required = f.required ? ';REQUIRED=TRUE' : '';
        const values = f.values?.length ? `;VALUES=${f.values.join(',')}` : '';
        lines.push(foldLine(`X-CXF-FIELD;KEY=${f.key};TYPE=${fieldTypeToCxf(f)}${required}${values}:${f.label ?? f.key}`));
    }
    lines.push('END:VSCHEMA');
    return lines.filter(Boolean).join('\r\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

function buildVTodo(
    node: IndexNode,
    opts: CxfExportOpts,
    links: EntityLink[],
    nodesByKey: Map<string, IndexNode>,
    archived: boolean,
    deleted: boolean,
): string {
    const m = node.meta as Record<string, unknown>;
    const { icsStatus, ext } = mapStatus(m.status as string | undefined, node.type);
    const uid = `${node.id}@${opts.vaultId}`;
    const lines: string[] = [
        'BEGIN:VTODO',
        prop('UID', uid),
        prop('SUMMARY', node.title),
        m.body ? prop('DESCRIPTION', String(m.body).replace(/\n/g, '\\n').slice(0, 65535)) : '',
        m.startDate ? prop('DTSTART', toIcsDate(String(m.startDate))) : '',
        m.dueDate ? prop('DUE', toIcsDate(String(m.dueDate))) : '',
        prop('PRIORITY', mapPriority(m.priority as string | undefined)),
        prop('STATUS', icsStatus),
        ext ? prop('X-CXF-STATUS-EXT', ext) : '',
        node.tags.length ? prop('CATEGORIES', node.tags.join(',')) : '',
        prop('CREATED', toIcsDate(m.created as string ?? '')),
        prop('LAST-MODIFIED', toIcsDate((m.updated ?? m.created) as string ?? '')),
        opts.ownerName ? `ORGANIZER;CN=${opts.ownerName}:mailto:${opts.ownerEmail}` : '',
    ];

    if (opts.includeGraph) {
        const attendees = buildAttendeeLines(links, nodesByKey, opts.vaultId);
        if (attendees) lines.push(attendees);
        const linkLines = buildLinkLines(links, opts.vaultId);
        if (linkLines) lines.push(linkLines);
    }

    lines.push(
        prop('X-CXF-ID', node.id),
        prop('X-CXF-TYPE', node.type),
        prop('X-CXF-VAULT', opts.vaultId),
        node.type === 'todont' && m.reason ? prop('X-CXF-FIELD-REASON', String(m.reason)) : '',
        archived ? 'X-CXF-ARCHIVED:TRUE' : '',
        deleted ? 'X-CXF-DELETED:TRUE' : '',
        'END:VTODO',
    );
    return lines.filter(Boolean).join('\r\n');
}

function buildVEvent(
    node: IndexNode,
    opts: CxfExportOpts,
    links: EntityLink[],
    nodesByKey: Map<string, IndexNode>,
    archived: boolean,
    deleted: boolean,
): string {
    const m = node.meta as Record<string, unknown>;
    const uid = `${node.id}@${opts.vaultId}`;
    const lines: string[] = [
        'BEGIN:VEVENT',
        prop('UID', uid),
        prop('SUMMARY', node.title),
        m.body ? prop('DESCRIPTION', String(m.body).replace(/\n/g, '\\n').slice(0, 65535)) : '',
        m.startDate ? prop('DTSTART', toIcsDate(String(m.startDate))) : '',
        m.endDate ? prop('DTEND', toIcsDate(String(m.endDate))) : '',
        m.duration ? prop('DURATION', String(m.duration)) : '',
        m.location ? prop('LOCATION', String(m.location).replace(/,/g, '\\,')) : '',
        node.tags.length ? prop('CATEGORIES', node.tags.join(',')) : '',
        prop('CREATED', toIcsDate(m.created as string ?? '')),
        prop('LAST-MODIFIED', toIcsDate((m.updated ?? m.created) as string ?? '')),
        opts.ownerName ? `ORGANIZER;CN=${opts.ownerName}:mailto:${opts.ownerEmail}` : '',
    ];

    if (opts.includeGraph) {
        const attendees = buildAttendeeLines(links, nodesByKey, opts.vaultId);
        if (attendees) lines.push(attendees);
        const linkLines = buildLinkLines(links, opts.vaultId);
        if (linkLines) lines.push(linkLines);
    }

    lines.push(
        prop('X-CXF-ID', node.id),
        prop('X-CXF-TYPE', node.type),
        prop('X-CXF-VAULT', opts.vaultId),
        archived ? 'X-CXF-ARCHIVED:TRUE' : '',
        deleted ? 'X-CXF-DELETED:TRUE' : '',
        'END:VEVENT',
    );
    return lines.filter(Boolean).join('\r\n');
}

function buildVJournal(
    node: IndexNode,
    opts: CxfExportOpts,
    links: EntityLink[],
    nodesByKey: Map<string, IndexNode>,
    archived: boolean,
    deleted: boolean,
): string {
    const m = node.meta as Record<string, unknown>;
    const uid = `${node.id}@${opts.vaultId}`;
    const lines: string[] = [
        'BEGIN:VJOURNAL',
        prop('UID', uid),
        prop('SUMMARY', node.title),
        m.body ? prop('DESCRIPTION', String(m.body).replace(/\n/g, '\\n').slice(0, 65535)) : '',
        prop('DTSTART', toIcsDate(m.created as string ?? '')),
        node.tags.length ? prop('CATEGORIES', node.tags.join(',')) : '',
        prop('CREATED', toIcsDate(m.created as string ?? '')),
        prop('LAST-MODIFIED', toIcsDate((m.updated ?? m.created) as string ?? '')),
    ];

    if (opts.includeGraph) {
        const linkLines = buildLinkLines(links, opts.vaultId);
        if (linkLines) lines.push(linkLines);
    }

    lines.push(
        prop('X-CXF-ID', node.id),
        prop('X-CXF-TYPE', node.type),
        prop('X-CXF-VAULT', opts.vaultId),
        archived ? 'X-CXF-ARCHIVED:TRUE' : '',
        deleted ? 'X-CXF-DELETED:TRUE' : '',
        'END:VJOURNAL',
    );
    return lines.filter(Boolean).join('\r\n');
}

function buildVContext(
    node: IndexNode,
    opts: CxfExportOpts,
    links: EntityLink[],
    nodesByKey: Map<string, IndexNode>,
    archived: boolean,
    deleted: boolean,
): string {
    const m = node.meta as Record<string, unknown>;
    const uid = `${node.id}@${opts.vaultId}`;
    const lines: string[] = [
        'BEGIN:VCONTEXT',
        prop('UID', uid),
        prop('SUMMARY', node.title),
        m.body ? prop('DESCRIPTION', String(m.body).replace(/\n/g, '\\n').slice(0, 65535)) : '',
        node.tags.length ? prop('CATEGORIES', node.tags.join(',')) : '',
        prop('CREATED', toIcsDate(m.created as string ?? '')),
        prop('LAST-MODIFIED', toIcsDate((m.updated ?? m.created) as string ?? '')),
        prop('X-CXF-ID', node.id),
        prop('X-CXF-TYPE', node.type),
        prop('X-CXF-VAULT', opts.vaultId),
    ];

    // Emit all non-system fields as X-CXF-FIELD-*
    const systemKeys = new Set(['id', 'title', 'entityType', 'created', 'updated', 'tags', 'summary', 'body', 'links']);
    for (const [k, v] of Object.entries(m)) {
        if (systemKeys.has(k) || v === undefined || v === null || v === '') continue;
        const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
        lines.push(foldLine(`X-CXF-FIELD-${k.toUpperCase()}:${val}`));
    }

    if (opts.includeGraph) {
        const attendees = buildAttendeeLines(links, nodesByKey, opts.vaultId);
        if (attendees) lines.push(attendees);
        const linkLines = buildLinkLines(links, opts.vaultId);
        if (linkLines) lines.push(linkLines);
    }

    lines.push(
        archived ? 'X-CXF-ARCHIVED:TRUE' : '',
        deleted ? 'X-CXF-DELETED:TRUE' : '',
        'END:VCONTEXT',
    );
    return lines.filter(Boolean).join('\r\n');
}

function buildTombstone(t: CxfTombstone, opts: CxfExportOpts): string {
    const uid = `${t.entityId}@${opts.vaultId}`;
    return [
        'BEGIN:VCONTEXT',
        prop('UID', uid),
        prop('SUMMARY', t.title),
        prop('LAST-MODIFIED', toIcsDate(new Date(t.updatedAtUnix * 1000).toISOString())),
        prop('X-CXF-ID', t.entityId),
        prop('X-CXF-VAULT', opts.vaultId),
        t.type === 'deleted' ? 'X-CXF-DELETED:TRUE' : 'X-CXF-ARCHIVED:TRUE',
        'END:VCONTEXT',
    ].join('\r\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTER
// ─────────────────────────────────────────────────────────────────────────────

const VTODO_TYPES = new Set(['task', 'goal', 'todont']);
const VEVENT_TYPES = new Set(['event']);
const VJOURNAL_TYPES = new Set(['note']);

function entityToComponent(
    node: IndexNode,
    opts: CxfExportOpts,
    nodesByKey: Map<string, IndexNode>,
    archived: boolean,
    deleted: boolean,
): string {
    const links = extractLinks(node.meta);
    if (VTODO_TYPES.has(node.type)) return buildVTodo(node, opts, links, nodesByKey, archived, deleted);
    if (VEVENT_TYPES.has(node.type)) return buildVEvent(node, opts, links, nodesByKey, archived, deleted);
    if (VJOURNAL_TYPES.has(node.type)) return buildVJournal(node, opts, links, nodesByKey, archived, deleted);
    return buildVContext(node, opts, links, nodesByKey, archived, deleted);
}

function extractLinks(meta: Record<string, unknown>): EntityLink[] {
    const raw = meta.links;
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((l): l is EntityLink => l && typeof l === 'object' && typeof l.target === 'string' && typeof l.label === 'string')
        .map(l => ({ target: l.target, label: l.label }));
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export interface SerializeResult {
    document: string;
    entityCount: number;
    schemaCount: number;
}

export function serializeToCxf(
    nodes: IndexNode[],
    entityTypes: EntityTypeConfig[],
    tombstones: CxfTombstone[],
    opts: CxfExportOpts,
): SerializeResult {
    // Build a fast lookup map for person resolution
    const nodesByKey = new Map<string, IndexNode>();
    for (const n of nodes) nodesByKey.set(`${n.type}:${n.id}`, n);

    const components: string[] = [];

    // VSCHEMA blocks
    const typeNames = new Set(nodes.map(n => n.type));
    const schemasToEmit = opts.includeSchema
        ? entityTypes.filter(t => typeNames.has(t.name))
        : [];
    for (const t of schemasToEmit) {
        components.push(buildVSchema(t));
    }

    // Entity components
    for (const node of nodes) {
        const archived = !!(node.meta.archivedAt as string | undefined);
        if (archived && !opts.includeArchived) continue;
        components.push(entityToComponent(node, opts, nodesByKey, archived, false));
    }

    // Tombstones
    for (const t of tombstones) {
        components.push(buildTombstone(t, opts));
    }

    const header = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        `PRODID:-//Phaibel//Phaibel CXF v1//EN`,
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        prop('X-CXF-VERSION', '1'),
        prop('X-CXF-VAULT', opts.vaultId),
        prop('X-CXF-EXPORT-TIME', String(opts.exportTime)),
        prop('X-CXF-OWNER-NAME', opts.ownerName),
        prop('X-CXF-OWNER-EMAIL', opts.ownerEmail),
    ].filter(Boolean).join('\r\n');

    const body = components.join('\r\n');
    const document = `${header}\r\n${body}\r\nEND:VCALENDAR`;

    return {
        document,
        entityCount: nodes.length + tombstones.length,
        schemaCount: schemasToEmit.length,
    };
}
