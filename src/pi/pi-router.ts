// ─────────────────────────────────────────────────────────────────────────────
// Phaibel Introspection — REST Router (/pi/*)
// ─────────────────────────────────────────────────────────────────────────────
// Read-only API exposing system state for dashboards, health checks,
// agent self-awareness, and debugging.
// Uses RFC 9457 Problem Details for errors (shared with CxMS).
// ─────────────────────────────────────────────────────────────────────────────

import type http from 'http';
import { jsonResponse, serverError } from '../cxms/problem-details.js';
import { loadUserProfile, loadPhaibelProfile } from '../profiles/profile-manager.js';
import { getConfiguredProviders, getEffectiveConfig } from '../config.js';
import { getDaemonStatus } from '../service/daemon.js';
import { findFoundationRoot } from '../state/manager.js';
import { loadCronConfig } from '../service/cron/scheduler.js';
import { loadEntityTypes } from '../entities/entity-type-config.js';
import { listEntities } from '../entities/entity.js';
import { bootstrapFeral, type FeralRuntime } from '../feral/bootstrap.js';
import { debug } from '../utils/debug.js';

// ── Lazy Feral Runtime ───────────────────────────────────────────────────────

let _feral: FeralRuntime | null = null;

async function getFeral(): Promise<FeralRuntime> {
    if (!_feral) {
        _feral = await bootstrapFeral();
    }
    return _feral;
}

// ── Router ───────────────────────────────────────────────────────────────────

/**
 * Handle all /pi/* routes. Returns true if handled, false if not matched.
 */
export async function handlePiRoute(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
): Promise<boolean> {
    const pathname = url.pathname;
    const method = req.method || 'GET';

    // All PI routes are GET-only
    if (method !== 'GET') return false;

    try {
        switch (pathname) {
            case '/pi/health':      return await handleHealth(res);
            case '/pi/profile':     return await handleProfile(res);
            case '/pi/agent':       return await handleAgent(res);
            case '/pi/providers':   return await handleProviders(res);
            case '/pi/capabilities': return await handleCapabilities(res);
            case '/pi/service':     return await handleService(res);
            case '/pi/foundation':  return await handleFoundation(res);
            case '/pi/cron':        return await handleCron(res);
            case '/pi/catalog':     return await handleCatalog(res);
            case '/pi/processes':   return await handleProcesses(res);
            default:                return false;
        }
    } catch (err) {
        debug('pi-router', `Error: ${err}`);
        serverError(res, err instanceof Error ? err.message : String(err), pathname);
        return true;
    }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleHealth(res: http.ServerResponse): Promise<boolean> {
    const root = await findFoundationRoot();
    const daemonStatus = await getDaemonStatus();
    const providers = await getConfiguredProviders();

    jsonResponse(res, 200, {
        status: root && providers.length > 0 ? 'ok' : 'degraded',
        foundation: root ? true : false,
        service: daemonStatus.running,
        providers: providers.length,
    });
    return true;
}

async function handleProfile(res: http.ServerResponse): Promise<boolean> {
    const profile = await loadUserProfile();
    jsonResponse(res, 200, profile);
    return true;
}

async function handleAgent(res: http.ServerResponse): Promise<boolean> {
    const profile = await loadPhaibelProfile();
    jsonResponse(res, 200, profile);
    return true;
}

async function handleProviders(res: http.ServerResponse): Promise<boolean> {
    const providers = await getConfiguredProviders();
    jsonResponse(res, 200, { providers });
    return true;
}

async function handleCapabilities(res: http.ServerResponse): Promise<boolean> {
    const config = await getEffectiveConfig();
    jsonResponse(res, 200, config);
    return true;
}

async function handleService(res: http.ServerResponse): Promise<boolean> {
    const status = await getDaemonStatus();
    jsonResponse(res, 200, {
        running: status.running,
        pid: status.pid,
        uptime: Math.round(process.uptime()),
        memory: {
            rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
            heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        },
    });
    return true;
}

async function handleFoundation(res: http.ServerResponse): Promise<boolean> {
    const root = await findFoundationRoot();
    if (!root) {
        jsonResponse(res, 200, { root: null, contextTypes: 0, totalNodes: 0 });
        return true;
    }

    const types = await loadEntityTypes();

    // Count total nodes across all types
    let totalNodes = 0;
    for (const t of types) {
        try {
            const entities = await listEntities(t.name, { metaOnly: true });
            totalNodes += entities.length;
        } catch {
            // Type directory may not exist
        }
    }

    jsonResponse(res, 200, {
        root,
        contextTypes: types.length,
        typeNames: types.map(t => t.name),
        totalNodes,
    });
    return true;
}

async function handleCron(res: http.ServerResponse): Promise<boolean> {
    const config = await loadCronConfig();
    jsonResponse(res, 200, { jobs: config.jobs });
    return true;
}

async function handleCatalog(res: http.ServerResponse): Promise<boolean> {
    const feral = await getFeral();
    const nodes = feral.catalog.getAllCatalogNodes();

    // Group by category (group field)
    const grouped: Record<string, Array<{ key: string; name: string; description: string }>> = {};
    for (const node of nodes) {
        const group = node.group || 'ungrouped';
        if (!grouped[group]) grouped[group] = [];
        grouped[group].push({
            key: node.key,
            name: node.name,
            description: node.description,
        });
    }

    jsonResponse(res, 200, { totalNodes: nodes.length, groups: grouped });
    return true;
}

async function handleProcesses(res: http.ServerResponse): Promise<boolean> {
    const feral = await getFeral();
    const processes = feral.processFactory.getAllProcesses();

    jsonResponse(res, 200, {
        count: processes.length,
        processes: processes.map(p => ({
            key: p.key,
            description: p.description,
        })),
    });
    return true;
}
