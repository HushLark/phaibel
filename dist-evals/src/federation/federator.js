// ─────────────────────────────────────────────────────────────────────────────
// Federator — fan-out FCP probes across all configured sources, merge results.
//
// The returned FederatedRelevance extends the deterministic local relevance
// (from query-relevance.ts) with remote signal, producing a compact hint
// block for the LLM that shows WHERE context lives without pulling bodies.
// ─────────────────────────────────────────────────────────────────────────────
import { probeSource, fetchFromSource, FcpError } from './fcp-client.js';
import { getEnabledSources } from './source-registry.js';
import { debug } from '../utils/debug.js';
// ── Actor resolution ─────────────────────────────────────────────────────────
async function getLocalActor() {
    // Stable identity for this Phaibel instance.
    // For v1 we derive from the vault + user — future: proper keypair signing.
    try {
        const { getUserName } = await import('../state/manager.js');
        const name = await getUserName().catch(() => 'unknown');
        return { agent_id: `phaibel:${name}` };
    }
    catch {
        return { agent_id: 'phaibel:unknown' };
    }
}
async function probeAllWithOpts(keywords, opts = {}) {
    const sources = await getEnabledSources();
    const mode = opts.mode ?? 'keyword';
    if (sources.length === 0)
        return { sources: [], hint: '', totalMs: 0 };
    if (mode === 'keyword' && keywords.length === 0)
        return { sources: [], hint: '', totalMs: 0 };
    const actor = await getLocalActor();
    const started = Date.now();
    const results = await Promise.all(sources.map(async (source) => {
        const t0 = Date.now();
        try {
            const resp = await probeSource(source, actor, keywords, {
                mode,
                timeoutMs: opts.timeoutMs ?? 600,
                entityTypes: opts.entityTypes,
                date: opts.date,
                dateTo: opts.dateTo,
                limit: opts.limit,
            });
            return {
                source: source.id,
                description: source.description,
                mode: source.mode ?? 'read',
                trust: source.trust,
                matches: resp.matches,
                latencyMs: Date.now() - t0,
            };
        }
        catch (err) {
            const msg = err instanceof FcpError ? err.message : String(err);
            debug('fcp', `probe ${source.id} failed: ${msg}`);
            return {
                source: source.id,
                description: source.description,
                mode: source.mode ?? 'read',
                trust: source.trust,
                matches: [],
                error: msg,
                latencyMs: Date.now() - t0,
            };
        }
    }));
    return {
        sources: results,
        hint: formatHint(results),
        totalMs: Date.now() - started,
    };
}
/** Keyword probe — fan-out keyword search to all configured sources. */
export async function probeAll(keywords, opts = {}) {
    return probeAllWithOpts(keywords, { mode: 'keyword', ...opts });
}
/** Date probe — ask all sources what they have for a given date (or range). */
export async function probeByDate(date, opts = {}) {
    return probeAllWithOpts([], { mode: 'date', date, dateTo: opts.dateTo ?? date, ...opts });
}
/** Todo probe — ask all sources for open tasks / action items. */
export async function probeTodos(opts = {}) {
    return probeAllWithOpts([], { mode: 'todo', entityTypes: ['task', 'todo', 'action'], ...opts });
}
/** Latest probe — ask all sources for their most recently created/updated items. */
export async function probeLatest(opts = {}) {
    return probeAllWithOpts([], { mode: 'latest', limit: opts.limit ?? 10, ...opts });
}
export async function fetchAll(requests, purpose) {
    const sources = await getEnabledSources();
    const byId = new Map(sources.map(s => [s.id, s]));
    const actor = await getLocalActor();
    return Promise.all(requests.map(async (req) => {
        const source = byId.get(req.source);
        if (!source) {
            return { source: req.source, nodes: [], denied_ids: req.ids, error: 'unknown source' };
        }
        try {
            const resp = await fetchFromSource(source, actor, req.ids, {
                detail: req.detail,
                purpose,
            });
            return { source: req.source, nodes: resp.nodes, denied_ids: resp.denied_ids };
        }
        catch (err) {
            const msg = err instanceof FcpError ? err.message : String(err);
            return { source: req.source, nodes: [], denied_ids: req.ids, error: msg };
        }
    }));
}
// ── Hint formatting ──────────────────────────────────────────────────────────
function formatHint(results) {
    const nonEmpty = results.filter(r => r.matches.length > 0);
    if (nonEmpty.length === 0)
        return '';
    const lines = [];
    for (const r of nonEmpty) {
        const parts = r.matches.map(m => `${m.type}:${m.count}`);
        const modeTag = r.mode === 'readwrite' ? 'rw' : 'ro';
        const desc = r.description ? ` — ${r.description}` : '';
        lines.push(`[${r.source} · ${r.trust} · ${modeTag}${desc}] ${parts.join(', ')}`);
        for (const m of r.matches) {
            for (const s of m.samples) {
                lines.push(`  ${m.type}:${s.id} "${s.title}" (${s.score.toFixed(2)})`);
            }
        }
    }
    return lines.join('\n');
}
