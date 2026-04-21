// ─────────────────────────────────────────────────────────────────────────────
// Federator — fan-out FCP probes across all configured sources, merge results.
//
// The returned FederatedRelevance extends the deterministic local relevance
// (from query-relevance.ts) with remote signal, producing a compact hint
// block for the LLM that shows WHERE context lives without pulling bodies.
// ─────────────────────────────────────────────────────────────────────────────

import { probeSource, fetchFromSource, FcpError } from './fcp-client.js';
import { getEnabledSources } from './source-registry.js';
import type { Actor, ProbeMatch, ProbeResponse, FetchedNode, SourceConfig, ProbeMode } from './fcp-types.js';
import { debug } from '../utils/debug.js';

export interface FederatedSourceResult {
    source: string;
    description?: string;
    mode: 'read' | 'readwrite';
    trust: 'own' | 'team' | 'peer' | 'public';
    matches: ProbeMatch[];
    error?: string;
    latencyMs: number;
}

export interface FederatedRelevance {
    /** One entry per source that responded (or errored). */
    sources: FederatedSourceResult[];
    /** Compact text hint safe to inject into an LLM prompt. */
    hint: string;
    /** Total wall time for all probes. */
    totalMs: number;
}

// ── Actor resolution ─────────────────────────────────────────────────────────

async function getLocalActor(): Promise<Actor> {
    // Stable identity for this Phaibel instance.
    // For v1 we derive from the vault + user — future: proper keypair signing.
    try {
        const { getUserName } = await import('../state/manager.js');
        const name = await getUserName().catch(() => 'unknown');
        return { agent_id: `phaibel:${name}` };
    } catch {
        return { agent_id: 'phaibel:unknown' };
    }
}

// ── Probe fan-out ────────────────────────────────────────────────────────────

export interface ProbeOpts {
    mode?: ProbeMode;
    entityTypes?: string[];
    timeoutMs?: number;
    /** For mode="date" — ISO-8601 date string (YYYY-MM-DD) */
    date?: string;
    /** For mode="date" — end of range (ISO-8601). Defaults to same as date for a single day. */
    dateTo?: string;
    /** For mode="latest" — max results to return per source */
    limit?: number;
}

async function probeAllWithOpts(
    keywords: string[],
    opts: ProbeOpts = {},
): Promise<FederatedRelevance> {
    const sources = await getEnabledSources();
    const mode = opts.mode ?? 'keyword';

    if (sources.length === 0) return { sources: [], hint: '', totalMs: 0 };
    if (mode === 'keyword' && keywords.length === 0) return { sources: [], hint: '', totalMs: 0 };

    const actor = await getLocalActor();
    const started = Date.now();

    const results = await Promise.all(sources.map(async (source): Promise<FederatedSourceResult> => {
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
        } catch (err) {
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
export async function probeAll(
    keywords: string[],
    opts: Pick<ProbeOpts, 'entityTypes' | 'timeoutMs'> = {},
): Promise<FederatedRelevance> {
    return probeAllWithOpts(keywords, { mode: 'keyword', ...opts });
}

/** Date probe — ask all sources what they have for a given date (or range). */
export async function probeByDate(
    date: string,
    opts: Pick<ProbeOpts, 'entityTypes' | 'timeoutMs' | 'dateTo'> = {},
): Promise<FederatedRelevance> {
    return probeAllWithOpts([], { mode: 'date', date, dateTo: opts.dateTo ?? date, ...opts });
}

/** Todo probe — ask all sources for open tasks / action items. */
export async function probeTodos(
    opts: Pick<ProbeOpts, 'timeoutMs'> = {},
): Promise<FederatedRelevance> {
    return probeAllWithOpts([], { mode: 'todo', entityTypes: ['task', 'todo', 'action'], ...opts });
}

/** Latest probe — ask all sources for their most recently created/updated items. */
export async function probeLatest(
    opts: Pick<ProbeOpts, 'entityTypes' | 'timeoutMs' | 'limit'> = {},
): Promise<FederatedRelevance> {
    return probeAllWithOpts([], { mode: 'latest', limit: opts.limit ?? 10, ...opts });
}

// ── Fetch — targeted full pull ───────────────────────────────────────────────

export interface FederatedFetchRequest {
    source: string;
    ids: string[];
    detail?: 'summary' | 'full';
}

export interface FederatedFetchResult {
    source: string;
    nodes: FetchedNode[];
    denied_ids: string[];
    error?: string;
}

export async function fetchAll(
    requests: FederatedFetchRequest[],
    purpose?: string,
): Promise<FederatedFetchResult[]> {
    const sources = await getEnabledSources();
    const byId = new Map<string, SourceConfig>(sources.map(s => [s.id, s]));
    const actor = await getLocalActor();

    return Promise.all(requests.map(async (req): Promise<FederatedFetchResult> => {
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
        } catch (err) {
            const msg = err instanceof FcpError ? err.message : String(err);
            return { source: req.source, nodes: [], denied_ids: req.ids, error: msg };
        }
    }));
}

// ── Hint formatting ──────────────────────────────────────────────────────────

function formatHint(results: FederatedSourceResult[]): string {
    const nonEmpty = results.filter(r => r.matches.length > 0);
    if (nonEmpty.length === 0) return '';

    const lines: string[] = [];
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
