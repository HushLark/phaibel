// ─────────────────────────────────────────────────────────────────────────────
// Phaibel Introspection — REST Router (/pi/*)
// ─────────────────────────────────────────────────────────────────────────────
// Read-only API exposing system state for dashboards, health checks,
// agent self-awareness, and debugging.
// Uses RFC 9457 Problem Details for errors (shared with CxMS).
// All handlers delegate to IntrospectionService.
// ─────────────────────────────────────────────────────────────────────────────

import type http from 'http';
import { jsonResponse, serverError } from '../cxms/problem-details.js';
import { IntrospectionService } from './introspection-service.js';
import { debug } from '../utils/debug.js';

const service = new IntrospectionService();

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
            // ── Original endpoints ───────────────────────────────────
            case '/pi/health':       jsonResponse(res, 200, await service.getHealth()); return true;
            case '/pi/profile':      jsonResponse(res, 200, await service.getProfile()); return true;
            case '/pi/agent':        jsonResponse(res, 200, await service.getAgent()); return true;
            case '/pi/providers':    jsonResponse(res, 200, await service.getProviders()); return true;
            case '/pi/capabilities': jsonResponse(res, 200, await service.getCapabilities()); return true;
            case '/pi/service':      jsonResponse(res, 200, await service.getService()); return true;
            case '/pi/foundation':   jsonResponse(res, 200, await service.getFoundation()); return true;
            case '/pi/cron':         jsonResponse(res, 200, await service.getCron()); return true;
            case '/pi/catalog':      jsonResponse(res, 200, await service.getCatalog()); return true;
            case '/pi/processes':    jsonResponse(res, 200, await service.getProcesses()); return true;

            // ── New v5.1 endpoints ───────────────────────────────────
            case '/pi/personality':   jsonResponse(res, 200, await service.getPersonality()); return true;
            case '/pi/settings':      jsonResponse(res, 200, await service.getSettings()); return true;
            case '/pi/entity-types':  jsonResponse(res, 200, await service.getEntityTypes()); return true;
            case '/pi/entity-stats':  jsonResponse(res, 200, await service.getEntityStats()); return true;
            case '/pi/queue':         jsonResponse(res, 200, await service.getQueue()); return true;
            case '/pi/token-usage': {
                const days = parseInt(url.searchParams.get('days') ?? '30', 10);
                jsonResponse(res, 200, await service.getTokenUsage(days));
                return true;
            }
            case '/pi/a2a-agents':    jsonResponse(res, 200, await service.getA2aAgents()); return true;
            case '/pi/calendars':         jsonResponse(res, 200, await service.getCalendars()); return true;
            case '/pi/cfx3-connections':  jsonResponse(res, 200, await service.getCfx3Connections()); return true;
            case '/pi/recent-chats': {
                const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);
                jsonResponse(res, 200, await service.getRecentChats(limit));
                return true;
            }

            default: return false;
        }
    } catch (err) {
        debug('pi-router', `Error: ${err}`);
        serverError(res, err instanceof Error ? err.message : String(err), pathname);
        return true;
    }
}
