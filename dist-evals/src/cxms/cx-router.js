// ─────────────────────────────────────────────────────────────────────────────
// CxMS — REST Router (/cx/*)
// ─────────────────────────────────────────────────────────────────────────────
// All /cx/* endpoints for the Context Management System.
// Uses RFC 9457 Problem Details for errors.
// Runs alongside the deprecated /api/* router.
// ─────────────────────────────────────────────────────────────────────────────
import path from 'path';
import { promises as fs } from 'fs';
import { listEntities, writeEntity, trashEntity, searchEntities, generateNodeId, ensureEntityDir, nodeFilename, } from '../entities/entity.js';
import { loadEntityTypes, getEntityType, addEntityType, updateEntityType, removeEntityType, } from '../entities/entity-type-config.js';
import { validateEntity, formatValidationErrors } from '../entities/entity-validator.js';
import { writeContextType, removeContextTypeDir, } from './context-type-store.js';
import { listCollections, loadCollection, getCollectionItem, countCollectionItems, } from './collections.js';
import { jsonResponse, badRequest, notFound, methodNotAllowed, conflict, unprocessable, serverError, readBody, } from './problem-details.js';
import { findFoundationRoot } from '../state/manager.js';
import { debug } from '../utils/debug.js';
// ── Router ───────────────────────────────────────────────────────────────────
/**
 * Handle all /cx/* routes. Returns true if handled, false if not matched.
 */
export async function handleCxRoute(req, res, url) {
    const pathname = url.pathname;
    const method = req.method || 'GET';
    try {
        // GET /cx/health
        if (pathname === '/cx/health' && method === 'GET') {
            return await handleHealth(res);
        }
        // POST /cx/search
        if (pathname === '/cx/search' && method === 'POST') {
            return await handleSearch(req, res);
        }
        // GET /cx/tag/{tag}
        const tagMatch = pathname.match(/^\/cx\/tag\/([^/]+)$/);
        if (tagMatch && method === 'GET') {
            return await handleTagSearch(res, decodeURIComponent(tagMatch[1]));
        }
        // GET /cx/date
        if (pathname === '/cx/date' && method === 'GET') {
            return await handleDateToday(res);
        }
        // GET /cx/date-range/{start}/{end}
        const dateRangeMatch = pathname.match(/^\/cx\/date-range\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/);
        if (dateRangeMatch && method === 'GET') {
            return await handleDateRange(res, dateRangeMatch[1], dateRangeMatch[2]);
        }
        // ── Collections ──────────────────────────────────────────────────
        // GET /cx/collections
        if (pathname === '/cx/collections' && method === 'GET') {
            return await handleListCollections(res);
        }
        // GET /cx/collection/{name}/count
        const collCountMatch = pathname.match(/^\/cx\/collection\/([^/]+)\/count$/);
        if (collCountMatch && method === 'GET') {
            return await handleCollectionCount(res, decodeURIComponent(collCountMatch[1]));
        }
        // GET /cx/collection/{name}/{key}
        const collItemMatch = pathname.match(/^\/cx\/collection\/([^/]+)\/([^/]+)$/);
        if (collItemMatch && method === 'GET') {
            return await handleCollectionItem(res, decodeURIComponent(collItemMatch[1]), decodeURIComponent(collItemMatch[2]));
        }
        // GET /cx/collection/{name}
        const collMatch = pathname.match(/^\/cx\/collection\/([^/]+)$/);
        if (collMatch && method === 'GET') {
            return await handleGetCollection(res, decodeURIComponent(collMatch[1]));
        }
        // ── Context Types ────────────────────────────────────────────────
        // GET /cx/context-types/count
        if (pathname === '/cx/context-types/count' && method === 'GET') {
            return await handleTypeCount(res);
        }
        // GET /cx/context-types
        if (pathname === '/cx/context-types' && method === 'GET') {
            return await handleListTypes(res);
        }
        // POST /cx/context-types
        if (pathname === '/cx/context-types' && method === 'POST') {
            return await handleCreateType(req, res);
        }
        // Routes with {type} param
        const typeMatch = pathname.match(/^\/cx\/context-types\/([^/]+)$/);
        if (typeMatch) {
            const typeName = decodeURIComponent(typeMatch[1]);
            if (method === 'GET')
                return await handleListNodes(req, res, url, typeName);
            if (method === 'POST')
                return await handleCreateNode(req, res, typeName);
            if (method === 'PUT')
                return await handleUpdateType(req, res, typeName);
            if (method === 'DELETE')
                return await handleDeleteType(res, typeName);
            methodNotAllowed(res, ['GET', 'POST', 'PUT', 'DELETE'], pathname);
            return true;
        }
        // GET /cx/context-types/{type}/details
        const detailsMatch = pathname.match(/^\/cx\/context-types\/([^/]+)\/details$/);
        if (detailsMatch && method === 'GET') {
            return await handleTypeDetails(res, decodeURIComponent(detailsMatch[1]));
        }
        // GET /cx/context-types/{type}/count
        const nodeCountMatch = pathname.match(/^\/cx\/context-types\/([^/]+)\/count$/);
        if (nodeCountMatch && method === 'GET') {
            return await handleNodeCount(res, decodeURIComponent(nodeCountMatch[1]));
        }
        // Routes with {type}/{id}
        const nodeMatch = pathname.match(/^\/cx\/context-types\/([^/]+)\/([^/]+)$/);
        if (nodeMatch) {
            const typeName = decodeURIComponent(nodeMatch[1]);
            const nodeId = decodeURIComponent(nodeMatch[2]);
            if (method === 'GET')
                return await handleGetNode(res, typeName, nodeId);
            if (method === 'PUT')
                return await handleUpdateNode(req, res, typeName, nodeId);
            if (method === 'DELETE')
                return await handleDeleteNode(res, typeName, nodeId);
            methodNotAllowed(res, ['GET', 'PUT', 'DELETE'], pathname);
            return true;
        }
        return false; // Not a /cx/ route we handle
    }
    catch (err) {
        debug('cx-router', `Error: ${err}`);
        serverError(res, err instanceof Error ? err.message : String(err), pathname);
        return true;
    }
}
// ── Health ───────────────────────────────────────────────────────────────────
async function handleHealth(res) {
    const root = await findFoundationRoot();
    const types = await loadEntityTypes();
    jsonResponse(res, 200, {
        status: root ? 'ok' : 'no-foundation',
        foundation: root || null,
        contextTypes: types.length,
    });
    return true;
}
// ── Search ───────────────────────────────────────────────────────────────────
async function handleSearch(req, res) {
    const raw = await readBody(req);
    let body;
    try {
        body = JSON.parse(raw || '{}');
    }
    catch {
        badRequest(res, 'Invalid JSON body');
        return true;
    }
    if (!body.query) {
        badRequest(res, 'Missing required field: query');
        return true;
    }
    const results = await searchEntities(body.query, body.type, { tags: body.tags });
    jsonResponse(res, 200, {
        query: body.query,
        count: results.length,
        results: results.map(r => ({
            id: r.meta.id,
            title: r.meta.title,
            type: r.meta.entityType || r.meta.contextType,
            score: r.score,
            tags: r.meta.tags,
            summary: r.meta.summary,
        })),
    });
    return true;
}
// ── Tag Search ───────────────────────────────────────────────────────────────
async function handleTagSearch(res, tag) {
    const types = await loadEntityTypes();
    const allResults = [];
    for (const t of types) {
        const entities = await listEntities(t.name, { tags: [tag] });
        for (const e of entities) {
            allResults.push({
                id: e.meta.id,
                title: e.meta.title,
                type: t.name,
                tags: e.meta.tags || [],
            });
        }
    }
    jsonResponse(res, 200, { tag, count: allResults.length, nodes: allResults });
    return true;
}
// ── Date Queries ─────────────────────────────────────────────────────────────
async function handleDateToday(res) {
    const today = new Date().toISOString().split('T')[0];
    const nodes = await getNodesForDateRange(today, today);
    jsonResponse(res, 200, { date: today, count: nodes.length, nodes });
    return true;
}
async function handleDateRange(res, start, end) {
    if (start > end) {
        badRequest(res, 'Start date must be before or equal to end date');
        return true;
    }
    const nodes = await getNodesForDateRange(start, end);
    jsonResponse(res, 200, { start, end, count: nodes.length, nodes });
    return true;
}
async function getNodesForDateRange(start, end) {
    const types = await loadEntityTypes();
    const results = [];
    for (const t of types) {
        if (!t.calendarDateField)
            continue;
        const entities = await listEntities(t.name);
        for (const e of entities) {
            const dateVal = String(e.meta[t.calendarDateField] || '').split('T')[0];
            if (dateVal >= start && dateVal <= end) {
                results.push({
                    id: e.meta.id,
                    title: e.meta.title,
                    type: t.name,
                    date: dateVal,
                    [t.calendarDateField]: e.meta[t.calendarDateField],
                });
            }
        }
    }
    return results;
}
// ── Collections ──────────────────────────────────────────────────────────────
async function handleListCollections(res) {
    const names = await listCollections();
    jsonResponse(res, 200, { count: names.length, collections: names });
    return true;
}
async function handleGetCollection(res, name) {
    const collection = await loadCollection(name);
    if (!collection) {
        notFound(res, `Collection "${name}" not found`);
        return true;
    }
    jsonResponse(res, 200, collection);
    return true;
}
async function handleCollectionItem(res, name, key) {
    const value = await getCollectionItem(name, key);
    if (value === null) {
        notFound(res, `Item "${key}" not found in collection "${name}"`);
        return true;
    }
    jsonResponse(res, 200, { key, value });
    return true;
}
async function handleCollectionCount(res, name) {
    const count = await countCollectionItems(name);
    jsonResponse(res, 200, { collection: name, count });
    return true;
}
// ── Context Type CRUD ────────────────────────────────────────────────────────
async function handleListTypes(res) {
    const types = await loadEntityTypes();
    jsonResponse(res, 200, {
        count: types.length,
        types: types.map(t => ({
            name: t.name,
            plural: t.plural,
            directory: t.directory,
            description: t.description,
            fields: t.fields,
            completionField: t.completionField,
            calendarDateField: t.calendarDateField,
        })),
    });
    return true;
}
async function handleTypeCount(res) {
    const types = await loadEntityTypes();
    jsonResponse(res, 200, { count: types.length });
    return true;
}
async function handleTypeDetails(res, typeName) {
    const typeConfig = await getEntityType(typeName);
    if (!typeConfig) {
        notFound(res, `Context type "${typeName}" not found`);
        return true;
    }
    // Load examples file if it exists
    let examples = null;
    const root = await findFoundationRoot();
    if (root) {
        const examplesPath = path.join(root, 'context-types', typeName, '.cxms-examples.md');
        try {
            examples = await fs.readFile(examplesPath, 'utf-8');
        }
        catch {
            // No examples file
        }
    }
    jsonResponse(res, 200, { ...typeConfig, examples });
    return true;
}
async function handleCreateType(req, res) {
    const raw = await readBody(req);
    let body;
    try {
        body = JSON.parse(raw || '{}');
    }
    catch {
        badRequest(res, 'Invalid JSON body');
        return true;
    }
    if (!body.name || !body.plural) {
        badRequest(res, 'Missing required fields: name, plural');
        return true;
    }
    const config = {
        name: body.name,
        plural: body.plural,
        directory: `context-types/${body.name}`,
        description: body.description,
        defaultTags: body.defaultTags,
        fields: body.fields || [],
        completionField: body.completionField,
        completionValue: body.completionValue,
        calendarDateField: body.calendarDateField,
        spawner: body.spawner,
    };
    try {
        await addEntityType(config);
        await writeContextType(config);
        jsonResponse(res, 201, config);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('already exists')) {
            conflict(res, msg);
        }
        else {
            badRequest(res, msg);
        }
    }
    return true;
}
async function handleUpdateType(req, res, typeName) {
    const existing = await getEntityType(typeName);
    if (!existing) {
        notFound(res, `Context type "${typeName}" not found`);
        return true;
    }
    const raw = await readBody(req);
    let body;
    try {
        body = JSON.parse(raw || '{}');
    }
    catch {
        badRequest(res, 'Invalid JSON body');
        return true;
    }
    const updated = {
        ...existing,
        ...body,
        name: typeName, // name is immutable
        directory: `context-types/${typeName}`,
    };
    try {
        await updateEntityType(typeName, updated);
        await writeContextType(updated);
        jsonResponse(res, 200, updated);
    }
    catch (err) {
        badRequest(res, err instanceof Error ? err.message : String(err));
    }
    return true;
}
async function handleDeleteType(res, typeName) {
    try {
        await removeEntityType(typeName);
        await removeContextTypeDir(typeName);
        jsonResponse(res, 200, { deleted: typeName });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('not found')) {
            notFound(res, msg);
        }
        else {
            badRequest(res, msg);
        }
    }
    return true;
}
// ── Context Node CRUD ────────────────────────────────────────────────────────
async function handleListNodes(_req, res, url, typeName) {
    const typeConfig = await getEntityType(typeName);
    if (!typeConfig) {
        notFound(res, `Context type "${typeName}" not found`);
        return true;
    }
    // Query params: status, tag, limit, offset
    const statusFilter = url.searchParams.get('status');
    const tagFilter = url.searchParams.get('tag');
    const limit = parseInt(url.searchParams.get('limit') || '0', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    let entities = await listEntities(typeName, tagFilter ? { tags: [tagFilter] } : undefined);
    // Status filter
    if (statusFilter) {
        entities = entities.filter(e => e.meta.status === statusFilter);
    }
    const total = entities.length;
    // Pagination
    if (offset > 0)
        entities = entities.slice(offset);
    if (limit > 0)
        entities = entities.slice(0, limit);
    jsonResponse(res, 200, {
        type: typeName,
        total,
        count: entities.length,
        offset,
        nodes: entities.map(e => ({
            id: e.meta.id,
            title: e.meta.title,
            type: typeName,
            tags: e.meta.tags || [],
            summary: e.meta.summary,
            created: e.meta.created,
            updated: e.meta.updated,
            ...extractCustomFields(e.meta, typeConfig),
        })),
    });
    return true;
}
async function handleGetNode(res, typeName, nodeId) {
    const typeConfig = await getEntityType(typeName);
    if (!typeConfig) {
        notFound(res, `Context type "${typeName}" not found`);
        return true;
    }
    const entities = await listEntities(typeName);
    const entity = entities.find(e => e.meta.id === nodeId);
    if (!entity) {
        notFound(res, `Node "${nodeId}" not found in type "${typeName}"`);
        return true;
    }
    // Build ancestor context
    const ancestorContext = await buildAncestorContext(typeName);
    jsonResponse(res, 200, {
        id: entity.meta.id,
        title: entity.meta.title,
        type: typeName,
        tags: entity.meta.tags || [],
        summary: entity.meta.summary,
        created: entity.meta.created,
        updated: entity.meta.updated,
        ...extractCustomFields(entity.meta, typeConfig),
        content: entity.content,
        references: entity.meta.references || entity.meta.links || [],
        ancestorContext,
    });
    return true;
}
async function handleCreateNode(req, res, typeName) {
    const typeConfig = await getEntityType(typeName);
    if (!typeConfig) {
        notFound(res, `Context type "${typeName}" not found`);
        return true;
    }
    const raw = await readBody(req);
    let body;
    try {
        body = JSON.parse(raw || '{}');
    }
    catch {
        badRequest(res, 'Invalid JSON body');
        return true;
    }
    if (!body.title) {
        badRequest(res, 'Missing required field: title');
        return true;
    }
    // Build metadata
    const id = generateNodeId();
    const now = new Date().toISOString();
    const meta = {
        id,
        title: body.title,
        entityType: typeName,
        contextType: typeName,
        created: now,
        tags: body.tags || typeConfig.defaultTags || [],
        ...extractBodyFields(body, typeConfig),
    };
    // Apply defaults for missing required fields
    for (const field of typeConfig.fields) {
        if (meta[field.key] === undefined && field.default !== undefined) {
            meta[field.key] = field.default;
        }
    }
    // Validate
    const errors = validateEntity(meta, typeConfig, true);
    if (errors.length > 0) {
        unprocessable(res, formatValidationErrors(errors));
        return true;
    }
    // Write file
    const dir = await ensureEntityDir(typeName);
    const filename = nodeFilename(body.title, id);
    const filepath = path.join(dir, filename);
    const content = body.content || '';
    await writeEntity(filepath, meta, content);
    jsonResponse(res, 201, { id, title: body.title, type: typeName, filepath: filename });
    return true;
}
async function handleUpdateNode(req, res, typeName, nodeId) {
    const typeConfig = await getEntityType(typeName);
    if (!typeConfig) {
        notFound(res, `Context type "${typeName}" not found`);
        return true;
    }
    const entities = await listEntities(typeName);
    const entity = entities.find(e => e.meta.id === nodeId);
    if (!entity) {
        notFound(res, `Node "${nodeId}" not found in type "${typeName}"`);
        return true;
    }
    const raw = await readBody(req);
    let body;
    try {
        body = JSON.parse(raw || '{}');
    }
    catch {
        badRequest(res, 'Invalid JSON body');
        return true;
    }
    // Merge fields
    const updatedMeta = { ...entity.meta };
    if (body.title !== undefined)
        updatedMeta.title = body.title;
    if (body.tags !== undefined)
        updatedMeta.tags = body.tags;
    if (body.summary !== undefined)
        updatedMeta.summary = body.summary;
    if (body.references !== undefined)
        updatedMeta.references = body.references;
    // Merge custom fields
    const customFields = extractBodyFields(body, typeConfig);
    Object.assign(updatedMeta, customFields);
    // Validate only changed fields
    const changedKeys = new Set(Object.keys(customFields));
    if (changedKeys.size > 0) {
        const errors = validateEntity(updatedMeta, typeConfig, false, changedKeys);
        if (errors.length > 0) {
            unprocessable(res, formatValidationErrors(errors));
            return true;
        }
    }
    const content = body.content !== undefined ? body.content : entity.content;
    await writeEntity(entity.filepath, updatedMeta, content);
    jsonResponse(res, 200, { id: nodeId, title: updatedMeta.title, type: typeName, updated: true });
    return true;
}
async function handleDeleteNode(res, typeName, nodeId) {
    const typeConfig = await getEntityType(typeName);
    if (!typeConfig) {
        notFound(res, `Context type "${typeName}" not found`);
        return true;
    }
    const entities = await listEntities(typeName);
    const entity = entities.find(e => e.meta.id === nodeId);
    if (!entity) {
        notFound(res, `Node "${nodeId}" not found in type "${typeName}"`);
        return true;
    }
    const trashPath = await trashEntity(entity.filepath);
    jsonResponse(res, 200, { deleted: nodeId, trashedTo: path.basename(trashPath) });
    return true;
}
async function handleNodeCount(res, typeName) {
    const typeConfig = await getEntityType(typeName);
    if (!typeConfig) {
        notFound(res, `Context type "${typeName}" not found`);
        return true;
    }
    const entities = await listEntities(typeName);
    jsonResponse(res, 200, { type: typeName, count: entities.length });
    return true;
}
// ── Helpers ──────────────────────────────────────────────────────────────────
/** Extract type-specific fields from entity meta, excluding system fields. */
function extractCustomFields(meta, typeConfig) {
    const custom = {};
    for (const field of typeConfig.fields) {
        if (meta[field.key] !== undefined) {
            custom[field.key] = meta[field.key];
        }
    }
    return custom;
}
/** Extract type-specific fields from request body. */
function extractBodyFields(body, typeConfig) {
    const fields = {};
    for (const field of typeConfig.fields) {
        if (body[field.key] !== undefined) {
            fields[field.key] = body[field.key];
        }
    }
    return fields;
}
/** Build ancestor context chain: root .cxms.md → type .cxms.md (with legacy fallback) */
async function buildAncestorContext(typeName) {
    const context = [];
    const root = await findFoundationRoot();
    if (!root)
        return context;
    // Read root context file (.cxms.md → .phaibel.md → .vault.md)
    for (const marker of ['.cxms.md', '.phaibel.md', '.vault.md']) {
        try {
            const rootMd = await fs.readFile(path.join(root, marker), 'utf-8');
            context.push(rootMd);
            break;
        }
        catch { /* try next */ }
    }
    // Read type context file
    for (const marker of ['.cxms.md', '.phaibel.md']) {
        try {
            const typeMd = await fs.readFile(path.join(root, 'context-types', typeName, marker), 'utf-8');
            context.push(typeMd);
            break;
        }
        catch { /* try next */ }
    }
    return context;
}
