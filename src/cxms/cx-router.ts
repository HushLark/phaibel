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
    findEntityByTitle,
    type EntityTypeName,
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
import { getModelForCapability } from '../llm/router.js';
import { getEntityIndex } from '../entities/entity-index.js';

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

        // POST /cx/summarize — summarize a meeting transcript (Rembr) and file it
        if (pathname === '/cx/summarize' && method === 'POST') {
            return await handleSummarize(req, res);
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

// POST /cx/summarize — used by Rembr (desktop meeting recorder). Summarizes a
// transcript via the configured `summarize` capability (synaptic / HushLark
// credits when logged in, BYOK otherwise) and best-effort files it as a
// knowledge node so the meeting enters Phaibel's context.
async function handleSummarize(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    const raw = await readBody(req);
    let body: Record<string, unknown>;
    try {
        body = JSON.parse(raw || '{}');
    } catch {
        badRequest(res, 'Invalid JSON body');
        return true;
    }

    const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
    if (!transcript) {
        badRequest(res, 'Missing required field: transcript');
        return true;
    }

    let provider;
    try {
        provider = await getModelForCapability('summarize');
    } catch (err) {
        serverError(res, (err as Error).message);
        return true;
    }

    const system = 'You summarize meeting transcripts. Respond ONLY with a single minified JSON object — no markdown, no commentary.';
    const user =
        'Summarize the following meeting transcript. Return JSON with exactly these keys:\n' +
        '"title": a short descriptive title (<= 8 words),\n' +
        '"summary": a 2-4 sentence plain-text summary,\n' +
        '"actionItems": array of short action-item strings (may be empty),\n' +
        '"decisions": array of short decision strings (may be empty),\n' +
        '"participants": array of participant names mentioned (may be empty).\n\n' +
        `TRANSCRIPT:\n${transcript}`;

    let responseText = '';
    try {
        responseText = await provider.chat(
            [{ role: 'system', content: system }, { role: 'user', content: user }],
            { temperature: 0.2 },
        );
    } catch (err) {
        // Summarization failed — still save the transcript below.
        debug('cx/summarize', `LLM summarize failed: ${(err as Error).message}`);
        responseText = '';
    }

    const parsed = parseSummaryJson(responseText);
    const result = {
        title: parsed.title || (body.title as string) || 'Meeting',
        summary: parsed.summary || responseText.trim(),
        actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
        participants: Array.isArray(parsed.participants) ? parsed.participants : [],
        nodeId: undefined as string | undefined,
        linkedPeople: [] as string[],
        createdPeople: [] as string[],
        linkedEvent: undefined as
            | { id: string; title: string; location?: string; startDate?: string; endDate?: string; attendees: string[] }
            | undefined,
    };

    // Direct graph neighbors of the meeting (attendees + scheduled event),
    // captured for the post-summary graph walk that surfaces related context.
    const directNeighbors: { key: string; name: string; relation: string }[] = [];

    // Persist the meeting as a CxMS context node, linked to people (creating any
    // it doesn't know yet). The transcript is stored in the node body.
    try {
        await ensureMeetingType();
        const now = new Date().toISOString();
        const links: { target: string; label: string }[] = [];

        // Match a scheduled calendar event first — its invite details (title,
        // attendees, location) enrich the call record.
        const scheduled = await findScheduledEvent(typeof body.startedAt === 'string' ? body.startedAt : undefined);
        if (scheduled) {
            result.linkedEvent = scheduled;
            // The invite name is authoritative for the call title.
            if (scheduled.title) result.title = scheduled.title;
            // Fold invite attendees into participants (so they get linked as people).
            for (const a of scheduled.attendees) {
                if (!result.participants.some(p => String(p).toLowerCase() === a.toLowerCase())) {
                    result.participants.push(a);
                }
            }
        }

        // Resolve/create a person entity per participant, collect frontmatter links.
        const seen = new Set<string>();
        for (const raw of result.participants) {
            const nm = String(raw ?? '').trim();
            const key = nm.toLowerCase();
            if (!nm || SELF_NAMES.has(key) || seen.has(key)) continue;
            seen.add(key);

            let personId: string;
            const existing = await findEntityByTitle('person' as EntityTypeName, nm);
            if (existing) {
                personId = String(existing.meta.id);
                result.linkedPeople.push(nm);
            } else {
                personId = generateNodeId();
                const pdir = await ensureEntityDir('person' as EntityTypeName);
                await writeEntity(
                    path.join(pdir, nodeFilename(nm, personId)),
                    { id: personId, title: nm, contextType: 'person', created: now, source: 'rembr' },
                    '',
                );
                result.createdPeople.push(nm);
            }
            links.push({ target: `person:${personId}`, label: 'attended' });
            directNeighbors.push({ key: `person:${personId}`, name: nm, relation: 'attended' });
        }

        if (scheduled) {
            links.push({ target: `event:${scheduled.id}`, label: 'scheduled-as' });
            directNeighbors.push({ key: `event:${scheduled.id}`, name: scheduled.title, relation: 'scheduled as' });
        }

        const id = generateNodeId();
        const meta: Record<string, unknown> = {
            id, title: result.title, contextType: 'meeting', created: now,
            ...(typeof body.startedAt === 'string' ? { date: body.startedAt } : {}),
            ...(typeof body.durationSeconds === 'number' ? { durationSeconds: body.durationSeconds } : {}),
            ...(result.participants.length ? { participants: result.participants } : {}),
            ...(result.actionItems.length ? { actionItems: result.actionItems } : {}),
            ...(result.decisions.length ? { decisions: result.decisions } : {}),
            ...(scheduled ? { event: { id: scheduled.id, title: scheduled.title, location: scheduled.location, startDate: scheduled.startDate, endDate: scheduled.endDate } } : {}),
            ...(links.length ? { links } : {}),
            source: 'rembr',
        };

        const sections: string[] = [];
        if (result.summary) sections.push(result.summary);
        if (result.actionItems.length) sections.push('## Action Items\n' + result.actionItems.map(a => `- ${a}`).join('\n'));
        if (result.decisions.length) sections.push('## Decisions\n' + result.decisions.map(d => `- ${d}`).join('\n'));
        sections.push('## Transcript\n' + transcript);

        const dir = await ensureEntityDir('meeting' as EntityTypeName);
        await writeEntity(path.join(dir, nodeFilename(result.title, id)), meta, sections.join('\n\n'));
        result.nodeId = id;
    } catch (err) {
        debug('cx/summarize', `filing failed: ${(err as Error).message}`);
    }

    // Once the meeting node exists, post it into the chat: a short note from the
    // assistant, then a graph walk from this node surfacing related people,
    // places, and things. Best-effort — never blocks the HTTP response.
    try {
        await postMeetingGraphToChat(result, directNeighbors);
    } catch (err) {
        debug('cx/summarize', `chat post failed: ${(err as Error).message}`);
    }

    jsonResponse(res, 200, result);
    return true;
}

// ── Post-summary graph walk → chat ─────────────────────────────────────────────
// After a call is recorded and summarized, announce it in the chat and run a
// one/two-hop walk of the knowledge graph from the new meeting node to surface
// the related context (attendees and what they connect to: places, things, …).

const PRIM_ORDER = ['person', 'place', 'thing', 'event', 'task', 'goal'];
const PRIM_LABEL: Record<string, string> = {
    person: 'People', place: 'Places', thing: 'Things', event: 'Events', task: 'Tasks', goal: 'Goals',
};

// Map every context type to its base category (person/place/thing/…) so
// discovered nodes can be grouped under the six life primitives.
async function baseCategoryByType(): Promise<Map<string, string>> {
    const m = new Map<string, string>();
    try {
        for (const t of await loadEntityTypes()) {
            m.set(t.name, (t.baseCategory as string) || 'thing');
        }
    } catch { /* defaults below */ }
    return m;
}

async function postMeetingGraphToChat(
    result: { nodeId?: string; title: string; summary: string; actionItems: string[]; decisions: string[] },
    directNeighbors: { key: string; name: string; relation: string }[],
): Promise<void> {
    if (!result.nodeId) return;

    let push: typeof import('../service/web-server.js');
    try {
        push = await import('../service/web-server.js');
    } catch {
        return; // web server not running (e.g. CLI) — nothing to post to
    }

    // 1) Conversational note from the assistant.
    const note: string[] = [`🎙️ I recorded and summarized **${result.title}**.`];
    if (result.summary) note.push('', result.summary);
    const counts: string[] = [];
    if (result.actionItems.length) counts.push(`${result.actionItems.length} action item${result.actionItems.length === 1 ? '' : 's'}`);
    if (result.decisions.length) counts.push(`${result.decisions.length} decision${result.decisions.length === 1 ? '' : 's'}`);
    if (counts.length) note.push('', `Captured ${counts.join(' and ')}.`);
    push.pushToChat(note.join('\n'), 'info');

    // 2) Walk the graph from the meeting node → related people, places, things.
    const meetingKey = `meeting:${result.nodeId}`;
    const catMap = await baseCategoryByType();
    const index = getEntityIndex();
    const meKey = index.getMeNode() ? `person:${index.getMeNode()!.id}` : '';

    const found = new Map<string, { name: string; category: string; relation: string }>();
    const add = (key: string, name: string, typeName: string, relation: string): void => {
        if (!key || key === meetingKey || key === meKey || found.has(key)) return;
        found.set(key, { name, category: catMap.get(typeName) || 'thing', relation });
    };

    // First hop: attendees + the scheduled event (from the links we just wrote).
    for (const d of directNeighbors) {
        add(d.key, d.name, d.key.split(':')[0], d.relation);
    }

    // Second hop: what each attendee / the event connects to (places, things,
    // goals, other people). New nodes have no edges yet, so this is a no-op for
    // freshly-created people — only established context surfaces.
    for (const d of directNeighbors) {
        let neighbors: ReturnType<typeof index.getNeighbors> = [];
        try { neighbors = index.getNeighbors(d.key); } catch { continue; }
        for (const n of neighbors) {
            add(`${n.node.type}:${n.node.id}`, n.node.name, n.node.type, `via ${d.name}`);
        }
    }

    // Group by base category and render as blocks.
    const byCat = new Map<string, { name: string; relation: string }[]>();
    for (const v of found.values()) {
        const arr = byCat.get(v.category) ?? [];
        arr.push({ name: v.name, relation: v.relation });
        byCat.set(v.category, arr);
    }

    const blocks: unknown[] = [{ type: 'heading', text: 'Related context', level: 3 }];
    let any = false;
    for (const cat of PRIM_ORDER) {
        const arr = byCat.get(cat);
        if (!arr?.length) continue;
        any = true;
        blocks.push({ type: 'markdown', text: `**${PRIM_LABEL[cat] ?? cat}**` });
        blocks.push({ type: 'list', items: arr.map(x => x.relation ? `${x.name} — ${x.relation}` : x.name) });
    }
    if (!any) {
        blocks.push({ type: 'markdown', text: '_No connected people, places, or things yet. As you record and link more, the graph fills in._' });
    }
    push.pushBlocks(blocks, '');
}

// Vault-owner aliases — never created as separate people or linked.
const SELF_NAMES = new Set(['you', 'me', 'myself', 'i', 'self']);

interface ScheduledEvent {
    id: string;
    title: string;
    location?: string;
    startDate?: string;
    endDate?: string;
    attendees: string[];
}

// Find a calendar event scheduled around the call's start. The call time must
// fall within the event ±3 minutes (so an event that started up to 3 minutes
// before the call still counts). Returns the closest match with its details.
async function findScheduledEvent(startedAtISO?: string): Promise<ScheduledEvent | null> {
    if (!startedAtISO) return null;
    const callStart = new Date(startedAtISO).getTime();
    if (isNaN(callStart)) return null;
    const GRACE = 3 * 60 * 1000;

    let best: { ev: ScheduledEvent; delta: number } | null = null;
    try {
        const events = await listEntities('event' as EntityTypeName);
        for (const e of events) {
            const start = new Date(String(e.meta.startDate ?? '')).getTime();
            if (isNaN(start)) continue;
            const endRaw = new Date(String(e.meta.endDate ?? e.meta.startDate ?? '')).getTime();
            const end = isNaN(endRaw) ? start : endRaw;
            if (callStart >= start - GRACE && callStart <= end + GRACE) {
                const delta = Math.abs(start - callStart);
                if (!best || delta < best.delta) {
                    best = {
                        delta,
                        ev: {
                            id: String(e.meta.id),
                            title: String(e.meta.title ?? 'Event'),
                            location: typeof e.meta.location === 'string' ? e.meta.location : undefined,
                            startDate: typeof e.meta.startDate === 'string' ? e.meta.startDate : undefined,
                            endDate: typeof e.meta.endDate === 'string' ? e.meta.endDate : undefined,
                            attendees: Array.isArray(e.meta.attendees) ? (e.meta.attendees as unknown[]).map(String) : [],
                        },
                    };
                }
            }
        }
    } catch { /* no events */ }
    return best ? best.ev : null;
}

// Ensure the 'meeting' context type exists so recorded calls become real CxMS nodes.
async function ensureMeetingType(): Promise<void> {
    if (await getEntityType('meeting')) return;
    try {
        await addEntityType({
            name: 'meeting',
            plural: 'meetings',
            directory: 'context-types/meeting',
            description: 'A recorded meeting or call with transcript, summary, action items, and participants',
            fields: [
                { key: 'date', type: 'datetime', label: 'Date' },
                { key: 'durationSeconds', type: 'number', label: 'Duration (seconds)' },
                { key: 'summary', type: 'string', label: 'Summary' },
            ],
        } as Parameters<typeof addEntityType>[0]);
    } catch {
        // Already created (e.g. concurrent request) — fine.
    }
}

function parseSummaryJson(text: string): {
    title?: string; summary?: string; actionItems?: string[]; decisions?: string[]; participants?: string[];
} {
    if (!text) return {};
    let t = text.trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) t = t.slice(start, end + 1);
    try {
        return JSON.parse(t);
    } catch {
        return {};
    }
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
