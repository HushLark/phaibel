// ─────────────────────────────────────────────────────────────────────────────
// Phaibel Analytics — REST Router (/analytics/*)
// ─────────────────────────────────────────────────────────────────────────────
// Read-only API exposing usage analytics.
// ─────────────────────────────────────────────────────────────────────────────

import type http from 'http';
import { jsonResponse, serverError } from '../cxms/problem-details.js';
import { getAnalyticsService } from './analytics-service.js';
import { debug } from '../utils/debug.js';

/**
 * Handle all /analytics/* routes. Returns true if handled, false if not matched.
 */
export async function handleAnalyticsRoute(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
): Promise<boolean> {
    const pathname = url.pathname;
    const method = req.method || 'GET';

    if (method !== 'GET') return false;

    const service = getAnalyticsService();

    try {
        switch (pathname) {
            case '/analytics/today': {
                jsonResponse(res, 200, await service.getToday());
                return true;
            }
            case '/analytics/summary': {
                const days = parseInt(url.searchParams.get('days') ?? '30', 10);
                jsonResponse(res, 200, await service.getSummary(days));
                return true;
            }
            case '/analytics/days': {
                const days = parseInt(url.searchParams.get('days') ?? '30', 10);
                jsonResponse(res, 200, await service.getDays(days));
                return true;
            }
            case '/analytics/pricing': {
                jsonResponse(res, 200, service.getModelPricing());
                return true;
            }
            default: return false;
        }
    } catch (err) {
        debug('analytics-router', `Error: ${err}`);
        serverError(res, err instanceof Error ? err.message : String(err), pathname);
        return true;
    }
}
