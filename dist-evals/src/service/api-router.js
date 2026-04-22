// ─────────────────────────────────────────────────────────────────────────────
// API ROUTER — REST endpoints for entity CRUD, types, search, and processes
// ─────────────────────────────────────────────────────────────────────────────
//
// All endpoints are JSON. Routes:
//
//   GET    /api/types                     — list all entity types with schemas
//   GET    /api/types/:type               — get one entity type schema
//   POST   /api/types                     — create a new entity type
//   PUT    /api/types/:type               — update an entity type
//   DELETE /api/types/:type               — remove an entity type (non-built-in)
//
//   GET    /api/entities/:type            — list entities (optional ?status=&tag=&due=)
//   GET    /api/entities/:type/:id        — get single entity
//   POST   /api/entities/:type            — create entity
//   PATCH  /api/entities/:type/:id        — update entity fields
//   DELETE /api/entities/:type/:id        — soft-delete (trash)
//
//   GET    /api/search?q=...&type=...     — full-text search
//
//   GET    /api/calendar                  — all dated entities for timeline display
//
//   GET    /api/processes                 — list available Feral processes
//   POST   /api/processes/:key/run        — execute a process with context
//
// ─────────────────────────────────────────────────────────────────────────────
import path from 'path';
import { promises as fs } from 'fs';
import { listEntities, parseEntity, writeEntity, trashEntity, searchEntities, generateEntityId, ensureEntityDir, getEntityDir, entityFilename, } from '../entities/entity.js';
import { loadEntityTypes, getEntityType, addEntityType, updateEntityType, removeEntityType } from '../entities/entity-type-config.js';
import { getEntityIndex } from '../entities/entity-index.js';
import { validateEntity, formatValidationErrors } from '../entities/entity-validator.js';
import { bootstrapFeral } from '../feral/bootstrap.js';
import { debug } from '../utils/debug.js';
import { upcomingAnnualDates } from '../context/annual-date-resolver.js';
// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}
function error(res, status, message) {
    json(res, status, { error: message });
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk.toString(); });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}
async function parseJsonBody(req) {
    const raw = await readBody(req);
    if (!raw)
        return {};
    return JSON.parse(raw);
}
// ─────────────────────────────────────────────────────────────────────────────
// ROUTER
// ─────────────────────────────────────────────────────────────────────────────
/** Lazy-cached Feral runtime for process execution. */
let _feral = null;
async function getFeral() {
    if (!_feral) {
        _feral = await bootstrapFeral();
    }
    return _feral;
}
/**
 * Try to handle an API request. Returns true if the route was matched,
 * false if no route matched (caller should handle 404).
 */
export async function handleApiRoute(req, res, url) {
    const method = req.method ?? 'GET';
    const pathname = url.pathname;
    // ── Calendar ────────────────────────────────────────────────────
    // GET /api/calendar — all dated entities for timeline display
    if (method === 'GET' && pathname === '/api/calendar') {
        const types = await loadEntityTypes();
        const calendarTypes = types.filter(t => t.calendarDateField);
        const items = [];
        // Build field map for annual date scanning
        const typeFieldMap = {};
        for (const t of types) {
            typeFieldMap[t.name] = t.fields.map(f => ({ key: f.key, label: f.label, type: f.type }));
        }
        // Gather all entities for annual date scanning
        const allEntitiesForAnnual = [];
        for (const t of calendarTypes) {
            try {
                const entities = await listEntities(t.name, { metaOnly: true });
                for (const e of entities) {
                    if (t.completionField && e.meta[t.completionField] === (t.completionValue ?? 'done'))
                        continue;
                    allEntitiesForAnnual.push({ id: String(e.meta.id ?? ''), type: t.name, title: String(e.meta.title ?? ''), meta: e.meta });
                    const rawDate = e.meta[t.calendarDateField];
                    if (!rawDate || typeof rawDate !== 'string')
                        continue;
                    const date = rawDate.slice(0, 10);
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
                        continue;
                    const item = {
                        entityType: t.name,
                        id: e.meta.id,
                        title: e.meta.title,
                        date,
                        dateField: t.calendarDateField,
                        meta: e.meta,
                    };
                    // Period item: has calendarEndField or calendarDurationField
                    if (t.calendarEndField || t.calendarDurationField) {
                        item.type = 'period';
                        if (t.calendarEndField)
                            item.endDate = e.meta[t.calendarEndField]?.slice(0, 10);
                        if (t.calendarDurationField)
                            item.duration = e.meta[t.calendarDurationField];
                    }
                    items.push(item);
                }
            }
            catch {
                // Entity dir may not exist yet — skip
            }
        }
        // Also scan all non-calendar types for annual date fields
        for (const t of types.filter(t => !t.calendarDateField)) {
            const hasAnnualFields = t.fields.some(f => f.type === 'date-fixed' || f.type === 'date-floating');
            if (!hasAnnualFields)
                continue;
            try {
                const entities = await listEntities(t.name, { metaOnly: true });
                for (const e of entities) {
                    allEntitiesForAnnual.push({ id: String(e.meta.id ?? ''), type: t.name, title: String(e.meta.title ?? ''), meta: e.meta });
                }
            }
            catch { /* skip */ }
        }
        // Resolve upcoming annual dates (within 60 days)
        const annualItems = upcomingAnnualDates(allEntitiesForAnnual, typeFieldMap, 60);
        for (const a of annualItems) {
            items.push({
                type: a.recurrenceType,
                entityType: a.entityType,
                id: a.entityId,
                title: `${a.title} — ${a.fieldLabel}`,
                date: a.date,
                daysAway: a.daysAway,
                fieldKey: a.fieldKey,
                rule: a.rule,
                recurrence: true,
                meta: {},
            });
        }
        json(res, 200, items);
        return true;
    }
    // ── Entity Types ─────────────────────────────────────────────────
    if (method === 'GET' && pathname === '/api/types') {
        const types = await loadEntityTypes();
        json(res, 200, types.map(t => ({
            name: t.name,
            plural: t.plural,
            directory: t.directory,
            description: t.description,
            defaultTags: t.defaultTags,
            fields: t.fields,
            completionField: t.completionField,
            completionValue: t.completionValue,
        })));
        return true;
    }
    // POST /api/types — create a new entity type
    if (method === 'POST' && pathname === '/api/types') {
        let body;
        try {
            body = await parseJsonBody(req);
        }
        catch {
            error(res, 400, 'Invalid JSON body');
            return true;
        }
        if (!body.name || typeof body.name !== 'string') {
            error(res, 400, 'Field "name" is required');
            return true;
        }
        if (!body.plural || typeof body.plural !== 'string') {
            error(res, 400, 'Field "plural" is required');
            return true;
        }
        if (!body.directory || typeof body.directory !== 'string') {
            error(res, 400, 'Field "directory" is required');
            return true;
        }
        const config = {
            name: body.name,
            plural: body.plural,
            directory: body.directory,
            description: typeof body.description === 'string' ? body.description : undefined,
            defaultTags: Array.isArray(body.defaultTags) ? body.defaultTags : [],
            fields: Array.isArray(body.fields) ? body.fields : [],
            completionField: typeof body.completionField === 'string' ? body.completionField : undefined,
            completionValue: typeof body.completionValue === 'string' ? body.completionValue : undefined,
        };
        try {
            await addEntityType(config);
            json(res, 201, config);
        }
        catch (err) {
            error(res, 409, err instanceof Error ? err.message : String(err));
        }
        return true;
    }
    const typeMatch = pathname.match(/^\/api\/types\/([^/]+)$/);
    // GET /api/types/:type — get one entity type schema
    if (method === 'GET' && typeMatch) {
        const typeName = decodeURIComponent(typeMatch[1]);
        const typeConfig = await getEntityType(typeName);
        if (!typeConfig) {
            error(res, 404, `Unknown entity type: "${typeName}"`);
            return true;
        }
        json(res, 200, {
            name: typeConfig.name,
            plural: typeConfig.plural,
            directory: typeConfig.directory,
            description: typeConfig.description,
            defaultTags: typeConfig.defaultTags,
            fields: typeConfig.fields,
            completionField: typeConfig.completionField,
            completionValue: typeConfig.completionValue,
        });
        return true;
    }
    // PUT /api/types/:type — update an entity type
    if (method === 'PUT' && typeMatch) {
        const typeName = decodeURIComponent(typeMatch[1]);
        let body;
        try {
            body = await parseJsonBody(req);
        }
        catch {
            error(res, 400, 'Invalid JSON body');
            return true;
        }
        const config = {
            name: typeof body.name === 'string' ? body.name : typeName,
            plural: typeof body.plural === 'string' ? body.plural : typeName + 's',
            directory: typeof body.directory === 'string' ? body.directory : typeName + 's',
            description: typeof body.description === 'string' ? body.description : undefined,
            defaultTags: Array.isArray(body.defaultTags) ? body.defaultTags : [],
            fields: Array.isArray(body.fields) ? body.fields : [],
            completionField: typeof body.completionField === 'string' ? body.completionField : undefined,
            completionValue: typeof body.completionValue === 'string' ? body.completionValue : undefined,
        };
        try {
            await updateEntityType(typeName, config);
            json(res, 200, config);
        }
        catch (err) {
            error(res, 404, err instanceof Error ? err.message : String(err));
        }
        return true;
    }
    // DELETE /api/types/:type — remove an entity type
    if (method === 'DELETE' && typeMatch) {
        const typeName = decodeURIComponent(typeMatch[1]);
        try {
            await removeEntityType(typeName);
            json(res, 200, { ok: true, name: typeName });
        }
        catch (err) {
            error(res, 400, err instanceof Error ? err.message : String(err));
        }
        return true;
    }
    // ── Search ───────────────────────────────────────────────────────
    if (method === 'GET' && pathname === '/api/search') {
        const q = url.searchParams.get('q') ?? '';
        const type = url.searchParams.get('type') || undefined;
        const tag = url.searchParams.get('tag') || undefined;
        if (!q && !tag) {
            error(res, 400, 'Query parameter "q" or "tag" is required');
            return true;
        }
        const results = await searchEntities(q, type, tag ? { tags: [tag] } : undefined);
        json(res, 200, results.map(r => ({
            id: r.meta.id,
            title: r.meta.title,
            entityType: r.meta.entityType,
            meta: r.meta,
            content: r.content,
            score: r.score,
        })));
        return true;
    }
    // ── Processes ────────────────────────────────────────────────────
    if (method === 'GET' && pathname === '/api/processes') {
        const feral = await getFeral();
        const processes = feral.processFactory.getAllProcesses();
        json(res, 200, processes.map(p => ({
            key: p.key,
            description: p.description,
            hasTool: !!p.tool,
        })));
        return true;
    }
    const processRunMatch = pathname.match(/^\/api\/processes\/([^/]+)\/run$/);
    if (method === 'POST' && processRunMatch) {
        const processKey = decodeURIComponent(processRunMatch[1]);
        const feral = await getFeral();
        let contextValues = {};
        try {
            contextValues = await parseJsonBody(req);
        }
        catch {
            error(res, 400, 'Invalid JSON body');
            return true;
        }
        try {
            const ctx = await feral.runner.run(processKey, contextValues);
            json(res, 200, { ok: true, result: ctx.getAll() });
        }
        catch (err) {
            error(res, 400, err instanceof Error ? err.message : String(err));
        }
        return true;
    }
    // ── Entity CRUD ──────────────────────────────────────────────────
    // GET /api/entities/:type — list
    const listMatch = pathname.match(/^\/api\/entities\/([^/]+)$/);
    if (method === 'GET' && listMatch) {
        const typeName = decodeURIComponent(listMatch[1]);
        const typeConfig = await getEntityType(typeName);
        if (!typeConfig) {
            error(res, 404, `Unknown entity type: "${typeName}"`);
            return true;
        }
        const entities = await listEntities(typeName);
        let results = entities;
        // Optional filters
        const statusFilter = url.searchParams.get('status');
        if (statusFilter) {
            results = results.filter(e => e.meta.status === statusFilter);
        }
        const tagFilter = url.searchParams.get('tag');
        if (tagFilter) {
            results = results.filter(e => {
                const tags = Array.isArray(e.meta.tags) ? e.meta.tags : [];
                return tags.some(t => t.toLowerCase() === tagFilter.toLowerCase());
            });
        }
        const dueFilter = url.searchParams.get('due');
        if (dueFilter) {
            // due=today, due=overdue, due=YYYY-MM-DD
            const today = new Date().toISOString().split('T')[0];
            if (dueFilter === 'today') {
                results = results.filter(e => e.meta.dueDate === today);
            }
            else if (dueFilter === 'overdue') {
                results = results.filter(e => e.meta.dueDate && e.meta.dueDate < today);
            }
            else {
                results = results.filter(e => e.meta.dueDate === dueFilter);
            }
        }
        json(res, 200, results.map(e => ({
            id: e.meta.id,
            title: e.meta.title,
            entityType: e.meta.entityType,
            meta: e.meta,
            content: e.content,
        })));
        return true;
    }
    // POST /api/entities/:type — create
    if (method === 'POST' && listMatch) {
        const typeName = decodeURIComponent(listMatch[1]);
        const typeConfig = await getEntityType(typeName);
        if (!typeConfig) {
            error(res, 404, `Unknown entity type: "${typeName}"`);
            return true;
        }
        let body;
        try {
            body = await parseJsonBody(req);
        }
        catch {
            error(res, 400, 'Invalid JSON body');
            return true;
        }
        if (!body.title) {
            error(res, 400, 'Field "title" is required');
            return true;
        }
        const id = generateEntityId(typeName);
        const dir = await ensureEntityDir(typeName);
        const title = body.title;
        const filepath = path.join(dir, entityFilename(title, id));
        const content = typeof body.content === 'string' ? body.content : '';
        delete body.content;
        const meta = {
            id,
            entityType: typeName,
            created: new Date().toISOString(),
            tags: [...(typeConfig.defaultTags ?? [])],
            ...body,
        };
        // Apply field defaults
        for (const fieldDef of typeConfig.fields) {
            if (meta[fieldDef.key] === undefined && fieldDef.default !== undefined) {
                meta[fieldDef.key] = fieldDef.default;
            }
        }
        // Validate against schema
        const validationErrors = validateEntity(meta, typeConfig, true);
        if (validationErrors.length > 0) {
            error(res, 400, `Validation failed: ${formatValidationErrors(validationErrors)}`);
            return true;
        }
        await writeEntity(filepath, meta, content);
        // Update index
        const index = getEntityIndex();
        if (index.isBuilt) {
            const tags = Array.isArray(meta.tags) ? meta.tags : [];
            await index.addOrUpdate(typeName, id, String(meta.title), filepath, tags);
        }
        debug('api', `Created ${typeName}: ${meta.title}`);
        json(res, 201, { id, title: meta.title, entityType: typeName, meta });
        return true;
    }
    // GET/PATCH/DELETE /api/entities/:type/:id
    const entityMatch = pathname.match(/^\/api\/entities\/([^/]+)\/([^/]+)$/);
    if (entityMatch) {
        const typeName = decodeURIComponent(entityMatch[1]);
        const entityId = decodeURIComponent(entityMatch[2]);
        const typeConfig = await getEntityType(typeName);
        if (!typeConfig) {
            error(res, 404, `Unknown entity type: "${typeName}"`);
            return true;
        }
        // Find the entity file
        const entity = await findEntityById(typeName, entityId);
        if (!entity) {
            error(res, 404, `Entity not found: ${typeName}/${entityId}`);
            return true;
        }
        // GET — read single entity
        if (method === 'GET') {
            json(res, 200, {
                id: entity.meta.id,
                title: entity.meta.title,
                entityType: entity.meta.entityType,
                meta: entity.meta,
                content: entity.content,
            });
            return true;
        }
        // PATCH — update fields
        if (method === 'PATCH') {
            let body;
            try {
                body = await parseJsonBody(req);
            }
            catch {
                error(res, 400, 'Invalid JSON body');
                return true;
            }
            // Update content if provided
            let content = entity.content;
            if (typeof body.content === 'string') {
                content = body.content;
                delete body.content;
            }
            // Merge fields into meta (don't allow changing id or entityType)
            const updatedMeta = { ...entity.meta };
            for (const [key, value] of Object.entries(body)) {
                if (key === 'id' || key === 'entityType')
                    continue;
                updatedMeta[key] = value;
            }
            // Validate only the fields being patched (not pre-existing data)
            const patchedFields = new Set(Object.keys(body).filter(k => k !== 'id' && k !== 'entityType'));
            const validationErrors = validateEntity(updatedMeta, typeConfig, false, patchedFields);
            if (validationErrors.length > 0) {
                error(res, 400, `Validation failed: ${formatValidationErrors(validationErrors)}`);
                return true;
            }
            await writeEntity(entity.filepath, updatedMeta, content);
            // Update index
            const index = getEntityIndex();
            if (index.isBuilt) {
                const tags = Array.isArray(updatedMeta.tags) ? updatedMeta.tags : [];
                await index.addOrUpdate(typeName, String(updatedMeta.id), String(updatedMeta.title), entity.filepath, tags);
            }
            debug('api', `Updated ${typeName}: ${updatedMeta.title}`);
            json(res, 200, {
                id: updatedMeta.id,
                title: updatedMeta.title,
                entityType: typeName,
                meta: updatedMeta,
                content,
            });
            return true;
        }
        // DELETE — soft-delete (trash)
        if (method === 'DELETE') {
            await trashEntity(entity.filepath);
            // Remove from index
            const index = getEntityIndex();
            if (index.isBuilt) {
                index.remove(typeName, String(entity.meta.id));
            }
            debug('api', `Deleted ${typeName}: ${entity.meta.title}`);
            json(res, 200, { ok: true, id: entity.meta.id, title: entity.meta.title });
            return true;
        }
    }
    // No route matched
    return false;
}
// ─────────────────────────────────────────────────────────────────────────────
// ENTITY LOOKUP
// ─────────────────────────────────────────────────────────────────────────────
async function findEntityById(typeName, entityId) {
    // Fast path: check entity index first
    const index = getEntityIndex();
    if (index.isBuilt) {
        const key = `${typeName}:${entityId}`;
        const node = index.getNode(key);
        if (node) {
            try {
                const raw = await fs.readFile(node.filepath, 'utf-8');
                const { meta, content } = parseEntity(node.filepath, raw);
                return { filepath: node.filepath, meta, content };
            }
            catch {
                // File gone — fall through to scan
            }
        }
    }
    // Scan directory for matching id field
    try {
        const dir = await getEntityDir(typeName);
        const files = await fs.readdir(dir);
        for (const file of files) {
            if (!file.endsWith('.md') || file.startsWith('.'))
                continue;
            const filepath = path.join(dir, file);
            const raw = await fs.readFile(filepath, 'utf-8');
            const { meta, content } = parseEntity(filepath, raw);
            if (meta.id === entityId) {
                return { filepath, meta, content };
            }
        }
    }
    catch {
        // Directory doesn't exist
    }
    return null;
}
