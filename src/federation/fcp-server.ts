// ─────────────────────────────────────────────────────────────────────────────
// FCP Server — expose this vault's context over the Federated Context Protocol.
//
// Routes mounted under /fcp/*:
//   GET  /fcp/manifest   — self-description
//   POST /fcp/probe      — counts + sample titles for keywords
//   POST /fcp/fetch      — full bodies for specific entity IDs
//
// All routes are gated by an actor identity supplied in the request body.
// v1 performs minimal auth (actor.agent_id must be present); bearer token
// validation and signature verification are hooks for later versions.
// ─────────────────────────────────────────────────────────────────────────────

import type http from 'http';
import { jsonResponse, badRequest, serverError, parseJsonBody, notFound } from '../cxms/problem-details.js';
import { getEntityIndex } from '../entities/entity-index.js';
import { loadEntityTypes } from '../entities/entity-type-config.js';
import { parseEntity } from '../entities/entity.js';
import { getPlatform } from '../platform/index.js';
import { debug } from '../utils/debug.js';
import {
    FCP_VERSION,
    ProbeRequestSchema, FetchRequestSchema,
    type ProbeMatch, type FetchedNode, type Manifest,
} from './fcp-types.js';

// ── Manifest ─────────────────────────────────────────────────────────────────

async function buildManifest(): Promise<Manifest> {
    const entityTypes = await loadEntityTypes().catch(() => []);
    return {
        fcp_version: FCP_VERSION,
        source: 'phaibel:self',
        name: 'Phaibel Vault',
        entity_types: entityTypes.map(t => t.name),
        scopes: entityTypes.map(t => t.name),
        auth_methods: ['bearer', 'none'],
        trust: 'peer',
    };
}

// ── Probe handler ───────────────────────────────────────────────────────────

async function handleProbe(res: http.ServerResponse, body: unknown): Promise<void> {
    const parsed = ProbeRequestSchema.safeParse(body);
    if (!parsed.success) {
        return badRequest(res, `invalid probe request: ${parsed.error.message}`);
    }
    const req = parsed.data;

    const index = getEntityIndex();
    if (!index.isBuilt) {
        try { await index.build(); } catch {}
    }

    const maxPerType = req.budget?.max_matches_per_type ?? 5;
    const typeFilter = new Set(req.query.hints?.entity_types ?? []);

    // Group matches by type; count = sum of hits across keywords; samples = top by score
    const byType = new Map<string, { count: number; samples: Map<string, { title: string; score: number }> }>();

    for (const keyword of req.query.keywords) {
        const results = index.search(keyword);
        for (const r of results) {
            const t = r.node.type;
            if (typeFilter.size > 0 && !typeFilter.has(t)) continue;
            const bucket = byType.get(t) ?? { count: 0, samples: new Map() };
            bucket.count++;
            const existing = bucket.samples.get(r.node.id);
            const normScore = Math.min(1, r.score / 10); // crude normalization
            if (!existing || existing.score < normScore) {
                bucket.samples.set(r.node.id, { title: r.node.title, score: normScore });
            }
            byType.set(t, bucket);
        }
    }

    const matches: ProbeMatch[] = [];
    for (const [type, bucket] of byType) {
        const sorted = Array.from(bucket.samples.entries())
            .map(([id, v]) => ({ id, title: v.title, score: v.score }))
            .sort((a, b) => b.score - a.score)
            .slice(0, maxPerType);
        matches.push({ type, count: bucket.count, samples: sorted });
    }

    debug('fcp', `probe from ${req.actor.agent_id}: ${req.query.keywords.join(',')} → ${matches.length} types`);

    jsonResponse(res, 200, {
        fcp_version: FCP_VERSION,
        source: 'phaibel:self',
        source_trust: 'peer',
        probed_at: new Date().toISOString(),
        ttl_seconds: 300,
        matches,
        token_estimate: { probe: 180, fetch_full: matches.reduce((a, m) => a + m.count * 400, 0) },
    });
}

// ── Fetch handler ───────────────────────────────────────────────────────────

async function handleFetch(res: http.ServerResponse, body: unknown): Promise<void> {
    const parsed = FetchRequestSchema.safeParse(body);
    if (!parsed.success) {
        return badRequest(res, `invalid fetch request: ${parsed.error.message}`);
    }
    const req = parsed.data;

    const index = getEntityIndex();
    if (!index.isBuilt) {
        try { await index.build(); } catch {}
    }

    const nodes: FetchedNode[] = [];
    const denied: string[] = [];

    const allNodes = index.getNodes();
    const byId = new Map(allNodes.map(n => [n.id, n]));

    for (const id of req.ids) {
        const indexNode = byId.get(id);
        if (!indexNode) { denied.push(id); continue; }

        try {
            const raw = await getPlatform().storage.readFile(indexNode.filepath);
            const parsed = parseEntity(indexNode.filepath, raw);
            const node: FetchedNode = {
                id: indexNode.id,
                type: indexNode.type as string,
                title: indexNode.title,
                summary: indexNode.summary,
                meta: parsed.meta,
            };
            if (req.detail === 'full') node.body = parsed.content;
            nodes.push(node);
        } catch (err) {
            debug('fcp', `fetch ${id} failed: ${err instanceof Error ? err.message : err}`);
            denied.push(id);
        }
    }

    debug('fcp', `fetch from ${req.actor.agent_id}: ${req.ids.length} ids, ${nodes.length} returned, purpose=${req.purpose ?? '-'}`);

    jsonResponse(res, 200, {
        fcp_version: FCP_VERSION,
        source: 'phaibel:self',
        nodes,
        denied_ids: denied,
        truncated: false,
    });
}

// ── Router ──────────────────────────────────────────────────────────────────

/**
 * Handle /fcp/* routes. Returns true if handled.
 */
export async function handleFcpRoute(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
): Promise<boolean> {
    const pathname = url.pathname;
    const method = req.method || 'GET';

    try {
        if (pathname === '/fcp/manifest' && method === 'GET') {
            jsonResponse(res, 200, await buildManifest());
            return true;
        }
        if (pathname === '/fcp/probe' && method === 'POST') {
            const body = await parseJsonBody(req);
            if (!body) return (badRequest(res, 'invalid JSON body'), true);
            await handleProbe(res, body);
            return true;
        }
        if (pathname === '/fcp/fetch' && method === 'POST') {
            const body = await parseJsonBody(req);
            if (!body) return (badRequest(res, 'invalid JSON body'), true);
            await handleFetch(res, body);
            return true;
        }
        if (pathname.startsWith('/fcp/')) {
            notFound(res, `unknown FCP route: ${pathname}`);
            return true;
        }
        return false;
    } catch (err) {
        serverError(res, err instanceof Error ? err.message : String(err));
        return true;
    }
}
