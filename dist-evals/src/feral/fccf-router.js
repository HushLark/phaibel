// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — REST Router (/fccf/*)
// ─────────────────────────────────────────────────────────────────────────────
// API for the Feral Composable Code Flow engine.
// Exposes catalog, process listing, and process execution.
// Uses RFC 9457 Problem Details for errors (shared with CxMS).
// ─────────────────────────────────────────────────────────────────────────────
import { jsonResponse, badRequest, notFound, serverError, readBody, } from '../cxms/problem-details.js';
import { bootstrapFeral } from './bootstrap.js';
import { hydrateProcess } from './process/process-json-hydrator.js';
import { DefaultContext } from './context/context.js';
import { debug } from '../utils/debug.js';
// ── Lazy Feral Runtime ───────────────────────────────────────────────────────
let _feral = null;
async function getFeral() {
    if (!_feral) {
        _feral = await bootstrapFeral();
    }
    return _feral;
}
// ── Router ───────────────────────────────────────────────────────────────────
/**
 * Handle all /fccf/* routes. Returns true if handled, false if not matched.
 */
export async function handleFccfRoute(req, res, url) {
    const pathname = url.pathname;
    const method = req.method || 'GET';
    try {
        // GET /fccf/health
        if (pathname === '/fccf/health' && method === 'GET') {
            return await handleHealth(res);
        }
        // GET /fccf/catalog
        if (pathname === '/fccf/catalog' && method === 'GET') {
            return await handleCatalog(res);
        }
        // GET /fccf/processes
        if (pathname === '/fccf/processes' && method === 'GET') {
            return await handleListProcesses(res);
        }
        // POST /fccf/process — run ad-hoc process (body = full process JSON)
        if (pathname === '/fccf/process' && method === 'POST') {
            return await handleRunAdhoc(req, res);
        }
        // POST /fccf/process/{processId} — run stored process with context
        const processMatch = pathname.match(/^\/fccf\/process\/([^/]+)$/);
        if (processMatch && method === 'POST') {
            return await handleRunStored(req, res, decodeURIComponent(processMatch[1]));
        }
        return false; // Not a /fccf/ route we handle
    }
    catch (err) {
        debug('fccf-router', `Error: ${err}`);
        serverError(res, err instanceof Error ? err.message : String(err), pathname);
        return true;
    }
}
// ── Handlers ─────────────────────────────────────────────────────────────────
async function handleHealth(res) {
    const feral = await getFeral();
    const catalogCount = feral.catalog.getAllCatalogNodes().length;
    const processCount = feral.processFactory.getAllProcesses().length;
    const vaultProcessCount = feral.vaultProcesses.length;
    jsonResponse(res, 200, {
        status: 'ok',
        catalog: catalogCount,
        builtInProcesses: processCount,
        vaultProcesses: vaultProcessCount,
    });
    return true;
}
async function handleCatalog(res) {
    const feral = await getFeral();
    const nodes = feral.catalog.getAllCatalogNodes();
    // Group by category
    const grouped = {};
    for (const node of nodes) {
        const group = node.group || 'ungrouped';
        if (!grouped[group])
            grouped[group] = [];
        grouped[group].push({
            key: node.key,
            name: node.name,
            nodeCodeKey: node.nodeCodeKey,
            description: node.description,
        });
    }
    jsonResponse(res, 200, { totalNodes: nodes.length, groups: grouped });
    return true;
}
async function handleListProcesses(res) {
    const feral = await getFeral();
    const processes = feral.processFactory.getAllProcesses();
    jsonResponse(res, 200, {
        count: processes.length,
        processes: processes.map(p => ({
            key: p.key,
            description: p.description,
            hasTool: !!p.tool,
        })),
    });
    return true;
}
async function handleRunAdhoc(req, res) {
    const raw = await readBody(req);
    let body;
    try {
        body = JSON.parse(raw || '{}');
    }
    catch {
        badRequest(res, 'Invalid JSON body');
        return true;
    }
    if (!body.process) {
        badRequest(res, 'Missing required field: process (full process JSON definition)');
        return true;
    }
    const feral = await getFeral();
    try {
        // Hydrate process from JSON and run it through the engine
        const process = hydrateProcess(body.process);
        const context = new DefaultContext();
        if (body.context) {
            for (const [k, v] of Object.entries(body.context)) {
                context.set(k, v);
            }
        }
        context.set('__process_engine', feral.engine);
        context.set('__process_factory', feral.processFactory);
        await feral.engine.process(process, context);
        jsonResponse(res, 200, { ok: true, result: context.getAll() });
    }
    catch (err) {
        badRequest(res, err instanceof Error ? err.message : String(err));
    }
    return true;
}
async function handleRunStored(req, res, processKey) {
    const raw = await readBody(req);
    let contextValues = {};
    try {
        if (raw)
            contextValues = JSON.parse(raw);
    }
    catch {
        badRequest(res, 'Invalid JSON body');
        return true;
    }
    const feral = await getFeral();
    try {
        const ctx = await feral.runner.run(processKey, contextValues);
        jsonResponse(res, 200, { ok: true, processKey, result: ctx.getAll() });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Cannot find process')) {
            notFound(res, msg);
        }
        else {
            badRequest(res, msg);
        }
    }
    return true;
}
