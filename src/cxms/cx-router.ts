// ─────────────────────────────────────────────────────────────────────────────
// CxMS — REST Router (/cx/*)
// ─────────────────────────────────────────────────────────────────────────────
// All /cx/* endpoints for the Context Management System.
// Uses RFC 9457 Problem Details for errors.
// Runs alongside the deprecated /api/* router.
// ─────────────────────────────────────────────────────────────────────────────

import type http from 'http';
import path from 'path';
import { promises as fs } from 'fs';
import {
    listEntities,
    parseEntity,
    writeEntity,
    trashEntity,
    searchEntities,
    generateNodeId,
    ensureEntityDir,
    nodeFilename,
} from '../entities/entity.js';
import { computeNodeDimensions } from './dimension-calculator.js';
import {
    loadEntityTypes,
    getEntityType,
    addEntityType,
    updateEntityType,
    removeEntityType,
    type EntityTypeConfig,
} from '../entities/entity-type-config.js';
import { validateEntity, formatValidationErrors } from '../entities/entity-validator.js';
import {
    loadContextTypesFromStore,
    writeContextType,
    writeAllContextTypes,
    removeContextTypeDir,
} from './context-type-store.js';
import {
    listCollections,
    loadCollection,
    getCollectionItem,
    countCollectionItems,
} from './collections.js';
import {
    jsonResponse,
    badRequest,
    notFound,
    methodNotAllowed,
    conflict,
    unprocessable,
    serverError,
    readBody,
} from './problem-details.js';
import { findFoundationRoot } from '../state/manager.js';
import { debug } from '../utils/debug.js';
import {
    isNodeTemporallyRelevant,
    getWindowBounds,
    todayStr,
} from '../entities/temporal-filter.js';

// ── Router ───────────────────────────────────────────────────────────────────

/**
 * Handle all /cx/* routes. Returns true if handled, false if not matched.
 */
export async function handleCxRoute(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
): Promise<boolean> {
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
            if (method === 'GET') return await handleListNodes(req, res, url, typeName);
            if (method === 'POST') return await handleCreateNode(req, res, typeName);
            if (method === 'PUT') return await handleUpdateType(req, res, typeName);
            if (method === 'DELETE') return await handleDeleteType(res, typeName);
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
            if (method === 'GET') return await handleGetNode(res, typeName, nodeId);
            if (method === 'PUT') return await handleUpdateNode(req, res, typeName, nodeId);
            if (method === 'DELETE') return await handleDeleteNode(res, typeName, nodeId);
            methodNotAllowed(res, ['GET', 'PUT', 'DELETE'], pathname);
            return true;
        }

        return false; // Not a /cx/ route we handle
    } catch (err) {
        debug('cx-router', `Error: ${err}`);
        serverError(res, err instanceof Error ? err.message : String(err), pathname);
        return true;
    }
}

// ── Health ───────────────────────────────────────────────────────────────────

async function handleHealth(res: http.ServerResponse): Promise<boolean> {
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

async function handleSearch(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    const raw = await readBody(req);
    let body: { query?: string; type?: string };
    try {
        body = JSON.parse(raw || '{}');
    } catch {
        badRequest(res, 'Invalid JSON body');
        return true;
    }

    if (!body.query) {
        badRequest(res, 'Missing required field: query');
        return true;
    }

    const results = await searchEntities(body.query, body.type);
    jsonResponse(res, 200, {
        query: body.query,
        count: results.length,
        results: results.map(r => ({
            id: r.meta.id,
            title: r.meta.title,
            type: r.meta.entityType || r.meta.contextType,
            score: r.score,
            summary: r.meta.summary,
        })),
    });
    return true;
}

// ── Date Queries ─────────────────────────────────────────────────────────────

async function handleDateToday(res: http.ServerResponse): Promise<boolean> {
    const today = todayStr();
    const nodes = await getNodesForDateRange(today, today);
    jsonResponse(res, 200, { date: today, count: nodes.length, nodes });
    return true;
}

async function handleDateRange(res: http.ServerResponse, start: string, end: string): Promise<boolean> {
    if (start > end) {
        badRequest(res, 'Start date must be before or equal to end date');
        return true;
    }
    const nodes = await getNodesForDateRange(start, end);
    jsonResponse(res, 200, { start, end, count: nodes.length, nodes });
    return true;
}

/**
 * Return nodes whose anchor date falls within [start, end].
 * When a type has a TemporalConfig, the query range is first intersected with
 * the type's window of importance so stale nodes are never surfaced.
 */
async function getNodesForDateRange(start: string, end: string): Promise<Array<Record<string, unknown>>> {
    const types = await loadEntityTypes();
    const results: Array<Record<string, unknown>> = [];
    const today = todayStr();

    for (const t of types) {
        // Use temporal.field if configured, fall back to calendarDateField
        const dateField = t.temporal?.field ?? t.calendarDateField;
        if (!dateField) continue;

        // Intersect the requested range with this type's window of importance
        let effectiveStart = start;
        let effectiveEnd   = end;
        if (t.temporal) {
            const win = getWindowBounds(t.temporal, today);
            effectiveStart = effectiveStart > win.from ? effectiveStart : win.from;
            effectiveEnd   = effectiveEnd   < win.to   ? effectiveEnd   : win.to;
            if (effectiveStart > effectiveEnd) continue; // window excludes this range entirely
        }

        const entities = await listEntities(t.name);
        for (const e of entities) {
            const dateVal = String(e.meta[dateField] || '').split('T')[0];
            if (dateVal >= effectiveStart && dateVal <= effectiveEnd) {
                results.push({
                    id: e.meta.id,
                    title: e.meta.title,
                    type: t.name,
                    date: dateVal,
                    [dateField]: e.meta[dateField],
                    ...(t.temporal?.endField && e.meta[t.temporal.endField]
                        ? { endDate: e.meta[t.temporal.endField] }
                        : {}),
                });
            }
        }
    }

    return results;
}

// ── Collections ──────────────────────────────────────────────────────────────

async function handleListCollections(res: http.ServerResponse): Promise<boolean> {
    const names = await listCollections();
    jsonResponse(res, 200, { count: names.length, collections: names });
    return true;
}

async function handleGetCollection(res: http.ServerResponse, name: string): Promise<boolean> {
    const collection = await loadCollection(name);
    if (!collection) {
        notFound(res, `Collection "${name}" not found`);
        return true;
    }
    jsonResponse(res, 200, collection);
    return true;
}

async function handleCollectionItem(res: http.ServerResponse, name: string, key: string): Promise<boolean> {
    const value = await getCollectionItem(name, key);
    if (value === null) {
        notFound(res, `Item "${key}" not found in collection "${name}"`);
        return true;
    }
    jsonResponse(res, 200, { key, value });
    return true;
}

async function handleCollectionCount(res: http.ServerResponse, name: string): Promise<boolean> {
    const count = await countCollectionItems(name);
    jsonResponse(res, 200, { collection: name, count });
    return true;
}

// ── Context Type CRUD ────────────────────────────────────────────────────────

async function handleListTypes(res: http.ServerResponse): Promise<boolean> {
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
            temporal: t.temporal ?? null,
        })),
    });
    return true;
}

async function handleTypeCount(res: http.ServerResponse): Promise<boolean> {
    const types = await loadEntityTypes();
    jsonResponse(res, 200, { count: types.length });
    return true;
}

async function handleTypeDetails(res: http.ServerResponse, typeName: string): Promise<boolean> {
    const typeConfig = await getEntityType(typeName);
    if (!typeConfig) {
        notFound(res, `Context type "${typeName}" not found`);
        return true;
    }

    // Load examples file if it exists
    let examples: string | null = null;
    const root = await findFoundationRoot();
    if (root) {
        const examplesPath = path.join(root, 'context-types', typeName, '.cxms-examples.md');
        try {
            examples = await fs.readFile(examplesPath, 'utf-8');
        } catch {
            // No examples file
        }
    }

    jsonResponse(res, 200, { ...typeConfig, examples });
    return true;
}

async function handleCreateType(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    const raw = await readBody(req);
    let body: Partial<EntityTypeConfig>;
    try {
        body = JSON.parse(raw || '{}');
    } catch {
        badRequest(res, 'Invalid JSON body');
        return true;
    }

    if (!body.name || !body.plural) {
        badRequest(res, 'Missing required fields: name, plural');
        return true;
    }

    const config: EntityTypeConfig = {
        name: body.name,
        plural: body.plural,
        directory: `context-types/${body.name}`,
        description: body.description,
        fields: body.fields || [],
        completionField: body.completionField,
        completionValue: body.completionValue,
        calendarDateField: body.calendarDateField,
        spawner: body.spawner,
        temporal: body.temporal,
    };

    try {
        await addEntityType(config);
        await writeContextType(config);
        jsonResponse(res, 201, config);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('already exists')) {
            conflict(res, msg);
        } else {
            badRequest(res, msg);
        }
    }
    return true;
}

async function handleUpdateType(req: http.IncomingMessage, res: http.ServerResponse, typeName: string): Promise<boolean> {
    const existing = await getEntityType(typeName);
    if (!existing) {
        notFound(res, `Context type "${typeName}" not found`);
        return true;
    }

    const raw = await readBody(req);
    let body: Partial<EntityTypeConfig>;
    try {
        body = JSON.parse(raw || '{}');
    } catch {
        badRequest(res, 'Invalid JSON body');
        return true;
    }

    const updated: EntityTypeConfig = {
        ...existing,
        ...body,
        name: typeName, // name is immutable
        directory: `context-types/${typeName}`,
    };

    try {
        await updateEntityType(typeName, updated);
        await writeContextType(updated);
        jsonResponse(res, 200, updated);
    } catch (err) {
        badRequest(res, err instanceof Error ? err.message : String(err));
    }
    return true;
}

async function handleDeleteType(res: http.ServerResponse, typeName: string): Promise<boolean> {
    try {
        await removeEntityType(typeName);
        await removeContextTypeDir(typeName);
        jsonResponse(res, 200, { deleted: typeName });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('not found')) {
            notFound(res, msg);
        } else {
            badRequest(res, msg);
        }
    }
    return true;
}

// ── Context Node CRUD ────────────────────────────────────────────────────────

async function handleListNodes(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
    typeName: string,
): Promise<boolean> {
    const typeConfig = await getEntityType(typeName);
    if (!typeConfig) {
        notFound(res, `Context type "${typeName}" not found`);
        return true;
    }

    // Query params: status, window, limit, offset
    const statusFilter = url.searchParams.get('status');
    const applyWindow  = url.searchParams.get('window') === 'true';
    const limit  = parseInt(url.searchParams.get('limit')  || '0', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    let entities = await listEntities(typeName);

    // Status filter
    if (statusFilter) {
        entities = entities.filter(e => e.meta.status === statusFilter);
    }

    // Temporal window filter — only applied when ?window=true is passed,
    // or when the type has a temporal config (always-on for temporal types)
    if (typeConfig.temporal && (applyWindow || typeConfig.temporal.windowDaysBefore > 0 || typeConfig.temporal.windowDaysAfter > 0)) {
        const today = todayStr();
        entities = entities.filter(e =>
            isNodeTemporallyRelevant(e.meta as Record<string, unknown>, typeConfig.temporal!, today),
        );
    }

    const total = entities.length;

    // Pagination
    if (offset > 0) entities = entities.slice(offset);
    if (limit > 0) entities = entities.slice(0, limit);

    jsonResponse(res, 200, {
        type: typeName,
        total,
        count: entities.length,
        offset,
        nodes: entities.map(e => ({
            id: e.meta.id,
            title: e.meta.title,
            type: typeName,
            summary: e.meta.summary,
            created: e.meta.created,
            updated: e.meta.updated,
            ...extractCustomFields(e.meta, typeConfig),
        })),
    });
    return true;
}

async function handleGetNode(res: http.ServerResponse, typeName: string, nodeId: string): Promise<boolean> {
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

async function handleCreateNode(req: http.IncomingMessage, res: http.ServerResponse, typeName: string): Promise<boolean> {
    const typeConfig = await getEntityType(typeName);
    if (!typeConfig) {
        notFound(res, `Context type "${typeName}" not found`);
        return true;
    }

    const raw = await readBody(req);
    let body: Record<string, unknown>;
    try {
        body = JSON.parse(raw || '{}');
    } catch {
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
    const meta: Record<string, unknown> = {
        id,
        title: body.title,
        contextType: typeName,
        created: now,
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

    // Compute and attach relevance dimensions before write
    if (typeConfig.dimensions?.length) {
        meta.dimensions = computeNodeDimensions(meta as Record<string, unknown>, typeConfig);
    }

    // Write file
    const dir = await ensureEntityDir(typeName);
    const filename = nodeFilename(body.title as string, id);
    const filepath = path.join(dir, filename);
    const content = (body.content as string) || '';
    await writeEntity(filepath, meta, content);

    jsonResponse(res, 201, { id, title: body.title, type: typeName, filepath: filename });
    return true;
}

async function handleUpdateNode(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    typeName: string,
    nodeId: string,
): Promise<boolean> {
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
    let body: Record<string, unknown>;
    try {
        body = JSON.parse(raw || '{}');
    } catch {
        badRequest(res, 'Invalid JSON body');
        return true;
    }

    // Merge fields
    const updatedMeta = { ...entity.meta };
    if (body.title !== undefined) updatedMeta.title = body.title;
    if (body.summary !== undefined) updatedMeta.summary = body.summary;
    if (body.references !== undefined) updatedMeta.references = body.references;

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

    // Recompute dimensions with updated field values
    if (typeConfig.dimensions?.length) {
        updatedMeta.dimensions = computeNodeDimensions(updatedMeta as Record<string, unknown>, typeConfig);
    }

    const content = body.content !== undefined ? (body.content as string) : entity.content;
    await writeEntity(entity.filepath, updatedMeta, content);

    jsonResponse(res, 200, { id: nodeId, title: updatedMeta.title, type: typeName, updated: true });
    return true;
}

async function handleDeleteNode(res: http.ServerResponse, typeName: string, nodeId: string): Promise<boolean> {
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

async function handleNodeCount(res: http.ServerResponse, typeName: string): Promise<boolean> {
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
function extractCustomFields(meta: Record<string, unknown>, typeConfig: EntityTypeConfig): Record<string, unknown> {
    const custom: Record<string, unknown> = {};
    for (const field of typeConfig.fields) {
        if (meta[field.key] !== undefined) {
            custom[field.key] = meta[field.key];
        }
    }
    return custom;
}

/** Extract type-specific fields from request body. */
function extractBodyFields(body: Record<string, unknown>, typeConfig: EntityTypeConfig): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    for (const field of typeConfig.fields) {
        if (body[field.key] !== undefined) {
            fields[field.key] = body[field.key];
        }
    }
    return fields;
}

/** Build ancestor context chain: root .cxms.md → type .cxms.md (with legacy fallback) */
async function buildAncestorContext(typeName: string): Promise<string[]> {
    const context: string[] = [];
    const root = await findFoundationRoot();
    if (!root) return context;

    // Read root context file (.cxms.md → .phaibel.md → .vault.md)
    for (const marker of ['.cxms.md', '.phaibel.md', '.vault.md']) {
        try {
            const rootMd = await fs.readFile(path.join(root, marker), 'utf-8');
            context.push(rootMd);
            break;
        } catch { /* try next */ }
    }

    // Read type context file
    for (const marker of ['.cxms.md', '.phaibel.md']) {
        try {
            const typeMd = await fs.readFile(path.join(root, 'context-types', typeName, marker), 'utf-8');
            context.push(typeMd);
            break;
        } catch { /* try next */ }
    }

    return context;
}
