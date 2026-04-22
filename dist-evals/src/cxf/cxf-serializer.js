// ─────────────────────────────────────────────────────────────────────────────
// CXF Serializer — converts Phaibel entities to a CXF/1 document.
// No LLM involvement. Implements CXF-SPEC.md §4–§8.
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// LINE FOLDING (RFC 5545 §3.1)
// ─────────────────────────────────────────────────────────────────────────────
function foldLine(line) {
    const LIMIT = 75;
    if (Buffer.byteLength(line, 'utf8') <= LIMIT)
        return line;
    const parts = [];
    let current = '';
    for (const char of line) {
        if (Buffer.byteLength(current + char, 'utf8') > LIMIT) {
            parts.push(current);
            current = ' ' + char;
        }
        else {
            current += char;
        }
    }
    if (current)
        parts.push(current);
    return parts.join('\r\n');
}
function prop(name, value) {
    if (!value && value !== '0')
        return '';
    return foldLine(`${name}:${value}`);
}
// ─────────────────────────────────────────────────────────────────────────────
// DATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function toIcsDate(iso) {
    // Returns YYYYMMDD for date-only, or YYYYMMDDTHHmmssZ for datetime
    if (!iso)
        return '';
    const d = iso.replace(/[-:]/g, '').replace('T', 'T').split('.')[0];
    if (iso.length <= 10)
        return d.slice(0, 8);
    return d.endsWith('Z') ? d : d + 'Z';
}
// ─────────────────────────────────────────────────────────────────────────────
// STATUS / PRIORITY MAPPING
// ─────────────────────────────────────────────────────────────────────────────
function mapStatus(status, type) {
    if (type === 'todont') {
        const map = {
            'open': 'NEEDS-ACTION', 'in-progress': 'IN-PROCESS',
            'done': 'COMPLETED', 'blocked': 'IN-PROCESS', 'cancelled': 'CANCELLED',
        };
        return { icsStatus: map[status ?? 'in-progress'] ?? 'IN-PROCESS', ext: status === 'blocked' ? 'blocked' : '' };
    }
    const map = {
        'open': 'NEEDS-ACTION', 'in-progress': 'IN-PROCESS',
        'done': 'COMPLETED', 'blocked': 'IN-PROCESS',
        'active': 'IN-PROCESS', 'completed': 'COMPLETED',
        'paused': 'IN-PROCESS', 'abandoned': 'CANCELLED',
    };
    const ext = status === 'blocked' ? 'blocked' : status === 'paused' ? 'paused' : '';
    return { icsStatus: map[status ?? 'open'] ?? 'NEEDS-ACTION', ext };
}
function mapPriority(priority) {
    const map = { critical: '1', high: '3', medium: '5', low: '9' };
    return map[priority ?? ''] ?? '0';
}
// ─────────────────────────────────────────────────────────────────────────────
// LINK HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function roleFromLabel(label) {
    const chair = ['assigned-to', 'owner', 'responsible'];
    const opt = ['attendee', 'invited'];
    const none = ['observer', 'cc', 'notify'];
    if (chair.includes(label))
        return 'CHAIR';
    if (opt.includes(label))
        return 'OPT-PARTICIPANT';
    if (none.includes(label))
        return 'NON-PARTICIPANT';
    return 'REQ-PARTICIPANT';
}
function buildAttendeeLines(links, nodesByKey, vaultId) {
    return links
        .filter(l => l.target.startsWith('person:'))
        .map(l => {
        const personNode = nodesByKey.get(l.target);
        const personId = l.target.replace('person:', '');
        const name = personNode?.title ?? personId;
        const email = personNode?.meta?.email ?? `${personId}@cxf.local`;
        const role = roleFromLabel(l.label);
        return foldLine(`ATTENDEE;CN=${name};ROLE=${role};PARTSTAT=NEEDS-ACTION;X-CXF-PERSON-ID=${personId}:mailto:${email}`);
    })
        .filter(Boolean)
        .join('\r\n');
}
function buildLinkLines(links, vaultId) {
    return links
        .filter(l => !l.target.startsWith('person:'))
        .map(l => foldLine(`X-CXF-LINK;LABEL=${l.label};EDGE=link:${l.target}@${vaultId}`))
        .join('\r\n');
}
// ─────────────────────────────────────────────────────────────────────────────
// VSCHEMA
// ─────────────────────────────────────────────────────────────────────────────
function fieldTypeToCxf(f) {
    const map = {
        string: 'TEXT', number: 'NUMBER', boolean: 'BOOLEAN',
        date: 'DATE', datetime: 'DATETIME', duration: 'DURATION', time: 'TIME',
        'date-fixed': 'DATE-FIXED', 'date-floating': 'DATE-FLOATING',
        reference: 'REFERENCE',
        enum: 'ENUM', array: 'ARRAY', object: 'OBJECT',
    };
    return map[f.type] ?? 'TEXT';
}
function buildVSchema(typeConfig) {
    const lines = [
        'BEGIN:VSCHEMA',
        prop('X-CXF-TYPE-NAME', typeConfig.name),
        prop('X-CXF-PLURAL', typeConfig.plural),
        typeConfig.description ? prop('X-CXF-DESCRIPTION', typeConfig.description.replace(/\n/g, '\\n')) : '',
    ];
    for (const f of typeConfig.fields) {
        const required = f.required ? ';REQUIRED=TRUE' : '';
        const values = f.values?.length ? `;VALUES=${f.values.join(',')}` : '';
        const targetType = f.targetType ? `;TARGETTYPE=${f.targetType}` : '';
        lines.push(foldLine(`X-CXF-FIELD;KEY=${f.key};TYPE=${fieldTypeToCxf(f)}${required}${values}${targetType}:${f.label ?? f.key}`));
    }
    lines.push('END:VSCHEMA');
    return lines.filter(Boolean).join('\r\n');
}
/** Serialize fields with special types (reference, date-fixed, date-floating, time). */
function buildSpecialFieldLines(m, typeConfig, vaultId, personNodesMap) {
    if (!typeConfig)
        return '';
    const lines = [];
    for (const f of typeConfig.fields) {
        const v = m[f.key];
        if (v === undefined || v === null || v === '')
            continue;
        const val = String(v);
        if (f.type === 'reference') {
            if (f.targetType === 'person') {
                const personNode = personNodesMap.get(`person:${val}`);
                const name = personNode?.title ?? val;
                const email = personNode?.meta?.email ?? `${val}@cxf.local`;
                lines.push(foldLine(`ATTENDEE;CN=${name};ROLE=REQ-PARTICIPANT;X-CXF-PERSON-ID=${val}:mailto:${email}`));
            }
            else {
                lines.push(foldLine(`X-CXF-LINK;TYPE=reference;TARGETTYPE=${f.targetType ?? ''};KEY=${f.key}:${val}@${vaultId}`));
            }
        }
        else if (f.type === 'date-fixed') {
            lines.push(foldLine(`X-CXF-DATE-FIXED;KEY=${f.key}:${val}`));
        }
        else if (f.type === 'date-floating') {
            lines.push(foldLine(`X-CXF-DATE-FLOATING;KEY=${f.key}:${val}`));
        }
        else if (f.type === 'time') {
            const icsTime = val.replace(/:/g, '').padEnd(6, '00').slice(0, 6);
            lines.push(foldLine(`X-CXF-FIELD-${f.key.toUpperCase()}:${icsTime}`));
        }
    }
    return lines.filter(Boolean).join('\r\n');
}
// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT BUILDERS
// ─────────────────────────────────────────────────────────────────────────────
function buildVTodo(node, opts, links, nodesByKey, archived, deleted) {
    const m = node.meta;
    const { icsStatus, ext } = mapStatus(m.status, node.type);
    const uid = `${node.id}@${opts.vaultId}`;
    const lines = [
        'BEGIN:VTODO',
        prop('UID', uid),
        prop('SUMMARY', node.title),
        m.body ? prop('DESCRIPTION', String(m.body).replace(/\n/g, '\\n').slice(0, 65535)) : '',
        m.startDate ? prop('DTSTART', toIcsDate(String(m.startDate))) : '',
        m.dueDate ? prop('DUE', toIcsDate(String(m.dueDate))) : '',
        prop('PRIORITY', mapPriority(m.priority)),
        prop('STATUS', icsStatus),
        ext ? prop('X-CXF-STATUS-EXT', ext) : '',
        node.tags.length ? prop('CATEGORIES', node.tags.join(',')) : '',
        prop('CREATED', toIcsDate(m.created ?? '')),
        prop('LAST-MODIFIED', toIcsDate((m.updated ?? m.created) ?? '')),
        opts.ownerName ? `ORGANIZER;CN=${opts.ownerName}:mailto:${opts.ownerEmail}` : '',
    ];
    if (opts.includeGraph) {
        const attendees = buildAttendeeLines(links, nodesByKey, opts.vaultId);
        if (attendees)
            lines.push(attendees);
        const linkLines = buildLinkLines(links, opts.vaultId);
        if (linkLines)
            lines.push(linkLines);
    }
    lines.push(prop('X-CXF-ID', node.id), prop('X-CXF-TYPE', node.type), prop('X-CXF-VAULT', opts.vaultId), node.type === 'todont' && m.reason ? prop('X-CXF-FIELD-REASON', String(m.reason)) : '', archived ? 'X-CXF-ARCHIVED:TRUE' : '', deleted ? 'X-CXF-DELETED:TRUE' : '', 'END:VTODO');
    return lines.filter(Boolean).join('\r\n');
}
function buildVEvent(node, opts, links, nodesByKey, archived, deleted) {
    const m = node.meta;
    const uid = `${node.id}@${opts.vaultId}`;
    const lines = [
        'BEGIN:VEVENT',
        prop('UID', uid),
        prop('SUMMARY', node.title),
        m.body ? prop('DESCRIPTION', String(m.body).replace(/\n/g, '\\n').slice(0, 65535)) : '',
        m.startDate ? prop('DTSTART', toIcsDate(String(m.startDate))) : '',
        m.endDate ? prop('DTEND', toIcsDate(String(m.endDate))) : '',
        m.duration ? prop('DURATION', String(m.duration)) : '',
        m.location ? prop('LOCATION', String(m.location).replace(/,/g, '\\,')) : '',
        node.tags.length ? prop('CATEGORIES', node.tags.join(',')) : '',
        prop('CREATED', toIcsDate(m.created ?? '')),
        prop('LAST-MODIFIED', toIcsDate((m.updated ?? m.created) ?? '')),
        opts.ownerName ? `ORGANIZER;CN=${opts.ownerName}:mailto:${opts.ownerEmail}` : '',
    ];
    if (opts.includeGraph) {
        const attendees = buildAttendeeLines(links, nodesByKey, opts.vaultId);
        if (attendees)
            lines.push(attendees);
        const linkLines = buildLinkLines(links, opts.vaultId);
        if (linkLines)
            lines.push(linkLines);
    }
    lines.push(prop('X-CXF-ID', node.id), prop('X-CXF-TYPE', node.type), prop('X-CXF-VAULT', opts.vaultId), archived ? 'X-CXF-ARCHIVED:TRUE' : '', deleted ? 'X-CXF-DELETED:TRUE' : '', 'END:VEVENT');
    return lines.filter(Boolean).join('\r\n');
}
function buildVJournal(node, opts, links, nodesByKey, archived, deleted) {
    const m = node.meta;
    const uid = `${node.id}@${opts.vaultId}`;
    const lines = [
        'BEGIN:VJOURNAL',
        prop('UID', uid),
        prop('SUMMARY', node.title),
        m.body ? prop('DESCRIPTION', String(m.body).replace(/\n/g, '\\n').slice(0, 65535)) : '',
        prop('DTSTART', toIcsDate(m.created ?? '')),
        node.tags.length ? prop('CATEGORIES', node.tags.join(',')) : '',
        prop('CREATED', toIcsDate(m.created ?? '')),
        prop('LAST-MODIFIED', toIcsDate((m.updated ?? m.created) ?? '')),
    ];
    if (opts.includeGraph) {
        const linkLines = buildLinkLines(links, opts.vaultId);
        if (linkLines)
            lines.push(linkLines);
    }
    lines.push(prop('X-CXF-ID', node.id), prop('X-CXF-TYPE', node.type), prop('X-CXF-VAULT', opts.vaultId), archived ? 'X-CXF-ARCHIVED:TRUE' : '', deleted ? 'X-CXF-DELETED:TRUE' : '', 'END:VJOURNAL');
    return lines.filter(Boolean).join('\r\n');
}
function buildVContext(node, opts, links, nodesByKey, archived, deleted, typeConfig) {
    const m = node.meta;
    const uid = `${node.id}@${opts.vaultId}`;
    const lines = [
        'BEGIN:VCONTEXT',
        prop('UID', uid),
        prop('SUMMARY', node.title),
        m.body ? prop('DESCRIPTION', String(m.body).replace(/\n/g, '\\n').slice(0, 65535)) : '',
        node.tags.length ? prop('CATEGORIES', node.tags.join(',')) : '',
        prop('CREATED', toIcsDate(m.created ?? '')),
        prop('LAST-MODIFIED', toIcsDate((m.updated ?? m.created) ?? '')),
        prop('X-CXF-ID', node.id),
        prop('X-CXF-TYPE', node.type),
        prop('X-CXF-VAULT', opts.vaultId),
    ];
    // Special-typed fields (reference, date-fixed, date-floating, time)
    const specialFieldKeys = new Set((typeConfig?.fields ?? [])
        .filter(f => f.type === 'reference' || f.type === 'date-fixed' || f.type === 'date-floating' || f.type === 'time')
        .map(f => f.key));
    const specialLines = buildSpecialFieldLines(m, typeConfig, opts.vaultId, nodesByKey);
    if (specialLines)
        lines.push(specialLines);
    // Emit remaining non-system fields as X-CXF-FIELD-*
    const systemKeys = new Set(['id', 'title', 'entityType', 'created', 'updated', 'tags', 'summary', 'body', 'links']);
    for (const [k, v] of Object.entries(m)) {
        if (systemKeys.has(k) || specialFieldKeys.has(k) || v === undefined || v === null || v === '')
            continue;
        const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
        lines.push(foldLine(`X-CXF-FIELD-${k.toUpperCase()}:${val}`));
    }
    if (opts.includeGraph) {
        const attendees = buildAttendeeLines(links, nodesByKey, opts.vaultId);
        if (attendees)
            lines.push(attendees);
        const linkLines = buildLinkLines(links, opts.vaultId);
        if (linkLines)
            lines.push(linkLines);
    }
    lines.push(archived ? 'X-CXF-ARCHIVED:TRUE' : '', deleted ? 'X-CXF-DELETED:TRUE' : '', 'END:VCONTEXT');
    return lines.filter(Boolean).join('\r\n');
}
function buildTombstone(t, opts) {
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
function entityToComponent(node, opts, nodesByKey, archived, deleted, typeConfig) {
    const links = extractLinks(node.meta);
    if (VTODO_TYPES.has(node.type))
        return buildVTodo(node, opts, links, nodesByKey, archived, deleted);
    if (VEVENT_TYPES.has(node.type)) {
        // Inject calendarEndField / calendarDurationField from typeConfig for non-default event types
        const tc = typeConfig;
        const m = node.meta;
        if (tc?.calendarEndField && !m.endDate) {
            m._cxfEndDate = m[tc.calendarEndField];
        }
        if (tc?.calendarDurationField && !m.duration) {
            m._cxfDuration = m[tc.calendarDurationField];
        }
        return buildVEvent(node, opts, links, nodesByKey, archived, deleted);
    }
    if (VJOURNAL_TYPES.has(node.type))
        return buildVJournal(node, opts, links, nodesByKey, archived, deleted);
    // For VCONTEXT types, emit DTSTART/DTEND if calendarDateField/calendarEndField is set
    if (typeConfig?.calendarDateField) {
        const m = node.meta;
        const start = m[typeConfig.calendarDateField];
        const end = typeConfig.calendarEndField ? m[typeConfig.calendarEndField] : undefined;
        const dur = typeConfig.calendarDurationField ? m[typeConfig.calendarDurationField] : undefined;
        if (start)
            m._cxfStart = start;
        if (end)
            m._cxfEnd = end;
        if (dur)
            m._cxfDuration = dur;
    }
    return buildVContext(node, opts, links, nodesByKey, archived, deleted, typeConfig);
}
function extractLinks(meta) {
    const raw = meta.links;
    if (!Array.isArray(raw))
        return [];
    return raw
        .filter((l) => l && typeof l === 'object' && typeof l.target === 'string' && typeof l.label === 'string')
        .map(l => ({ target: l.target, label: l.label }));
}
export function serializeToCxf(nodes, entityTypes, tombstones, opts) {
    // Build a fast lookup map for person resolution
    const nodesByKey = new Map();
    for (const n of nodes)
        nodesByKey.set(`${n.type}:${n.id}`, n);
    const components = [];
    // VSCHEMA blocks
    const typeNames = new Set(nodes.map(n => n.type));
    const schemasToEmit = opts.includeSchema
        ? entityTypes.filter(t => typeNames.has(t.name))
        : [];
    for (const t of schemasToEmit) {
        components.push(buildVSchema(t));
    }
    // Build type config lookup for richer per-field serialization
    const typeConfigByName = new Map(entityTypes.map(t => [t.name, t]));
    // Entity components
    for (const node of nodes) {
        const archived = !!node.meta.archivedAt;
        if (archived && !opts.includeArchived)
            continue;
        const tc = typeConfigByName.get(node.type);
        components.push(entityToComponent(node, opts, nodesByKey, archived, false, tc));
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
