import type { LLMProvider } from '../llm/types.js';
import type { EntityIndex, IndexNode } from '../entities/entity-index.js';
import type { IntentResult } from './intent-classifier.js';
import type { ContextManifest } from './context-manifest.js';
import { serializeManifest } from './context-manifest.js';
import { parseJsonResponse } from '../utils/json-parser.js';
import { loadEntityTypes, getSpecificity, SPECIFICITY_BONUS, type EntityTypeConfig } from '../entities/entity-type-config.js';
import { resolveDomainDimensions } from '../entities/base-categories.js';
import { debug } from '../utils/debug.js';
import type { ClassificationResult } from './request-classifier.js';
import type { RequestWeights } from './request-weights.js';
import { buildFetchRequests } from './request-weights.js';

export interface FetchRequest {
    type?: string;   // entity type filter; omit or '*' to search all types
    query?: string;
    ids?: string[];
    limit?: number;
}

export interface LoopDecision {
    action: 'fetch' | 'ready';
    reasoning: string;
    requests?: FetchRequest[];
    contextSummary?: string;
}

export interface GatheredContext {
    nodes: IndexNode[];
    summary: string;
    rounds: number;
}

interface FailedFetch {
    requests: FetchRequest[];
    reason: string;
}

export async function runContextLoop(
    llm: LLMProvider,
    intent: IntentResult,
    manifest: ContextManifest,
    entityIndex: EntityIndex,
    maxRounds = 3,
): Promise<GatheredContext> {
    const fetched: IndexNode[] = [];
    const failedFetches: FailedFetch[] = [];
    let rounds = 0;
    let lastSummary = '';

    for (let round = 0; round < maxRounds; round++) {
        rounds = round + 1;

        const fetchedSummary = fetched.length > 0
            ? fetched.map(n => {
                const metaStr = Object.entries(n.meta)
                    .filter(([k]) => !['id', 'entityType', 'contextType', 'source', 'body', 'content', 'filepath'].includes(k))
                    .slice(0, 6)
                    .map(([k, v]) => `${k}:${JSON.stringify(v)}`)
                    .join(', ');
                return `[${n.type}:${n.id}] "${n.name}" — ${metaStr}`;
            }).join('\n')
            : '(none yet)';

        const failedBlock = failedFetches.length > 0
            ? `\nPrevious fetch attempts that returned nothing (try a different approach):\n${failedFetches.map(f =>
                `- ${f.requests.map(r => `${r.type} query="${r.query ?? '(all)'}"`).join(', ')}: ${f.reason}`
            ).join('\n')}\n`
            : '';

        const raw = await llm.chat(
            [{
                role: 'user' as const,
                content: `Intent: ${intent.summary}
Action type: ${intent.actionType}

Available context (manifest):
${serializeManifest(manifest)}

Already fetched (${fetched.length} entities):
${fetchedSummary}
${failedBlock}
What context do you need to design an action for the user? You have ${maxRounds - round} round(s) remaining.
Return JSON:
  { "action": "fetch", "reasoning": "...", "requests": [{ "type": "task", "query": "keyword", "limit": 10 }] }
  OR
  { "action": "ready", "reasoning": "...", "contextSummary": "one paragraph summary of what you found" }

Rules:
- Declare ready when you have enough to design an action or answer the user
- Only fetch what you need; avoid over-fetching
- For "query", use plain keywords (e.g. "overdue", "sprint") — NOT field:value syntax (e.g. NOT "due:2026-05-05")
- To fetch all entities of a type, omit "query" and set a limit
- Dates in YYYY-MM-DD format in the query are supported for date-range filtering`,
            }],
            {
                systemPrompt: 'You are a context gathering agent for a personal assistant. Fetch only the entities needed to understand the user\'s situation. Return JSON only.',
                temperature: 0,
            },
        );

        let decision: LoopDecision;
        try {
            decision = parseJsonResponse(raw) as unknown as LoopDecision;
        } catch {
            debug('chat', `Context loop parse failed at round ${round + 1}`);
            lastSummary = `Gathered ${fetched.length} entities`;
            break;
        }

        debug('chat', `Context loop round ${round + 1}: action=${decision.action}, reason="${decision.reasoning}"`);

        if (decision.action === 'ready') {
            lastSummary = decision.contextSummary || `${fetched.length} entities gathered`;
            break;
        }

        if (decision.action === 'fetch' && Array.isArray(decision.requests)) {
            const anchorKeys = new Set(fetched.map(n => `${n.type}:${n.id}`));
            const newNodes = (await fulfillRequests(decision.requests, entityIndex, anchorKeys)).map(r => r.node);
            let added = 0;
            const addedKeys: string[] = [];
            for (const node of newNodes) {
                if (!fetched.some(n => n.type === node.type && n.id === node.id)) {
                    fetched.push(node);
                    addedKeys.push(`${node.type}:${node.id}`);
                    added++;
                }
            }
            // Record behavioral signal for every node that entered context
            if (addedKeys.length > 0) {
                import('../cxms/behavioral-index.js')
                    .then(({ getBehavioralIndex }) => getBehavioralIndex().recordMany(addedKeys))
                    .catch(() => {});
            }
            debug('chat', `Context loop round ${round + 1}: fetched ${newNodes.length} new entities (total: ${fetched.length})`);

            if (added === 0) {
                failedFetches.push({
                    requests: decision.requests,
                    reason: 'No matching entities found',
                });
            }
        }

        if (round === maxRounds - 1) {
            lastSummary = `Gathered ${fetched.length} entities across ${maxRounds} round(s)`;
        }
    }

    return {
        nodes: fetched,
        summary: lastSummary || `${fetched.length} entities gathered`,
        rounds,
    };
}

// ISO date pattern: 2026-05-05 (possibly with field prefix like "due:2026-05-05")
const DATE_PATTERN = /\b(\d{4}-\d{2}-\d{2})\b/;

/** A retrieved node with a comparable relevance score for cross-type ranking. */
export interface ScoredNode { node: IndexNode; score: number; }

// Tier base scores keep heterogeneous fetch branches on one comparable scale
// (relevance dominates; keyword/fallback sit below); the per-node specificity
// multiplier then lets a specific-typed node edge out an equally-relevant
// generic one. See docs/RELEVANCE-DIMENSIONS.md.
const TIER_ID       = 1.00;
const TIER_DATE     = 0.70;
const TIER_KEYWORD  = 0.45;
const TIER_FALLBACK = 0.15;
const relevanceTier = (s: number) => 0.4 + 0.5 * s; // [0,1] → [0.4,0.9]

export async function fulfillRequests(
    requests: FetchRequest[],
    entityIndex: EntityIndex,
    anchorKeys: Set<string> = new Set(),
    requestWeights?: RequestWeights,
    sourceScope?: string,
): Promise<ScoredNode[]> {
    const entityTypes = await loadEntityTypes();
    const typeConfigMap = new Map(entityTypes.map(t => [t.name, t]));

    // CF/x3 connection scope: when set, only consider nodes federated from that
    // source (meta.source === sourceScope), so "in <connection>, …" stays on-topic.
    const inScope = (n: IndexNode): boolean => !sourceScope || n.meta.source === sourceScope;

    // Specificity multiplier per type (1 + β·depth-below-base), cached.
    const specCache = new Map<string, number>();
    const specMult = (typeName: string): number => {
        let m = specCache.get(typeName);
        if (m === undefined) {
            m = 1 + SPECIFICITY_BONUS * getSpecificity(typeConfigMap.get(typeName), typeConfigMap);
            specCache.set(typeName, m);
        }
        return m;
    };

    const results: ScoredNode[] = [];
    const add = (node: IndexNode, base: number) => results.push({ node, score: base * specMult(node.type) });

    for (const req of requests) {
        // Normalise type: treat '*' or empty string as all-type
        const typeKey = (req.type && req.type !== '*') ? req.type : undefined;

        if (req.ids && req.ids.length > 0) {
            for (const id of req.ids) {
                if (!typeKey) continue;
                const node = entityIndex.getNode(`${typeKey}:${id}`);
                if (node && inScope(node)) add(node, TIER_ID);
            }
            continue;
        }

        const query = req.query ?? '';
        const limit = req.limit ?? 10;
        const typeConfig = typeKey ? typeConfigMap.get(typeKey) : undefined;

        // Date-based filter: if query contains YYYY-MM-DD, match against entity meta
        const dateMatch = query.match(DATE_PATTERN);
        if (dateMatch) {
            const targetDate = dateMatch[1];
            const found = entityIndex.getNodes(typeKey as import('../entities/entity.js').EntityTypeName | undefined)
                .filter(inScope)
                .filter(n => Object.values(n.meta).some(v =>
                    typeof v === 'string' && v.startsWith(targetDate)
                ))
                .slice(0, limit);
            for (const n of found) add(n, TIER_DATE);
            continue;
        }

        // Relevance-scored fetch when the type declares relevance dimensions
        // (own, inherited from parent, or its base-category default). Temporal
        // types flow through here too — temporal is a scored dimension whose
        // nonzero support acts as the in-window filter (no separate path).
        const dims = resolveDomainDimensions(typeConfig, typeConfigMap);
        if (dims.length > 0) {
            try {
                const scored = await entityIndex.searchByRelevance(
                    query,
                    typeKey as import('../entities/entity.js').EntityTypeName | undefined,
                    anchorKeys,
                    dims,
                    requestWeights,
                    undefined,
                    sourceScope,
                );
                for (const r of scored.slice(0, limit)) add(r.node, relevanceTier(r.score));
                continue;
            } catch (err) {
                debug('context-loop', `Relevance scoring failed for ${typeKey}, falling back: ${err}`);
            }
        }

        if (query) {
            const found = entityIndex.search(query, typeKey as import('../entities/entity.js').EntityTypeName | undefined)
                .filter(r => inScope(r.node)).slice(0, limit);
            if (found.length > 0) {
                for (const r of found) add(r.node, TIER_KEYWORD);
            } else if (typeKey) {
                // Keyword search returned nothing for a typed request — fall back to
                // all entities of this type (query was likely just the type name).
                for (const n of entityIndex.getNodes(typeKey as import('../entities/entity.js').EntityTypeName).filter(inScope).slice(0, limit)) add(n, TIER_FALLBACK);
            }
        } else {
            for (const n of entityIndex.getNodes(typeKey as import('../entities/entity.js').EntityTypeName | undefined).filter(inScope).slice(0, limit)) add(n, TIER_FALLBACK);
        }
    }
    return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIFICATION-DRIVEN FETCH
// Replaces runContextLoop for the full pipeline: deterministic, 0 LLM calls.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch relevant context nodes using signals from the classification result.
 *
 * One request per identified subject (with entity type + optional date tag),
 * plus a fallback general query.  Each request is fulfilled via
 * relevance-scored search when dimension config is available, otherwise
 * keyword search.  Temporal date filtering applies when an isoDate was
 * extracted by the classifier.
 *
 * Replaces `runContextLoop` for task/remember/create/none categories,
 * eliminating 1–3 LLM calls on the critical path.
 */
export async function fetchContextByClassification(
    classification: ClassificationResult,
    requestWeights: RequestWeights,
    entityIndex: EntityIndex,
    entityTypes: EntityTypeConfig[],
    maxNodes = 20,
    sourceScope?: string,
): Promise<GatheredContext> {
    const requests = buildFetchRequests(classification);
    // Map to FetchRequest (type is optional, which fulfillRequests now supports)
    const fetchReqs: FetchRequest[] = requests.map(r => ({
        type:  r.entityType,
        query: r.query,
        limit: r.limit,
    }));
    // When scoped to a CF/x3 connection, add a broad untyped pull so the source's
    // nodes still surface for generic asks ("what's the latest in <connection>").
    if (sourceScope) fetchReqs.push({ query: '', limit: maxNodes });

    const scored = await fulfillRequests(fetchReqs, entityIndex, new Set(), requestWeights, sourceScope);

    // Merge across requests: dedup keeping the highest score per node, then rank
    // by score (specificity-boosted) and cap. This is what makes a specific-typed
    // node outrank an equally-relevant generic one across types.
    const byKey = new Map<string, ScoredNode>();
    for (const sn of scored) {
        const key = `${sn.node.type}:${sn.node.id}`;
        const prev = byKey.get(key);
        if (!prev || sn.score > prev.score) byKey.set(key, sn);
    }
    const unique = [...byKey.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, maxNodes)
        .map(s => s.node);

    // Record behavioral signals (fire-and-forget)
    const keys = unique.map(n => `${n.type}:${n.id}`);
    if (keys.length > 0) {
        import('../cxms/behavioral-index.js')
            .then(({ getBehavioralIndex }) => getBehavioralIndex().recordMany(keys))
            .catch(() => {});
    }

    const typesSeen = [...new Set(unique.map(n => n.type))].join(', ');
    const summary = unique.length > 0
        ? `${unique.length} entities (${typesSeen}) via classification-driven fetch`
        : 'No entities matched the request';

    debug('chat', `fetchContextByClassification: ${unique.length} nodes, rounds=1, types=${typesSeen || 'none'}`);

    return { nodes: unique, summary, rounds: 1 };
}

/** Convert a UTC ISO string (ending in Z) to a local ISO string with timezone offset. */
function utcToLocalIso(value: string): string {
    if (!value.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(value)) return value;
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    const off = d.getTimezoneOffset();
    const sign = off <= 0 ? '+' : '-';
    const oh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
    const om = String(Math.abs(off) % 60).padStart(2, '0');
    const tz = `${sign}${oh}:${om}`;
    const Y = d.getFullYear();
    const M = String(d.getMonth() + 1).padStart(2, '0');
    const D = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${Y}-${M}-${D}T${h}:${min}:${s}${tz}`;
}

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function serializeGatheredContext(gathered: GatheredContext): string {
    if (gathered.nodes.length === 0) {
        return `GATHERED CONTEXT: No entities found. Summary: ${gathered.summary}`;
    }

    const lines = gathered.nodes.map(n => {
        const metaStr = Object.entries(n.meta)
            .filter(([k]) => !['id', 'entityType', 'contextType', 'source', 'filepath', 'content', 'body'].includes(k))
            .slice(0, 8)
            .map(([k, v]) => {
                // Convert UTC datetime strings to local time for display
                const display = typeof v === 'string' && ISO_DATETIME_RE.test(v) ? utcToLocalIso(v) : v;
                return `${k}:${JSON.stringify(display)}`;
            })
            .join(', ');
        const via = typeof n.meta.source === 'string' && n.meta.source ? ` (via ${n.meta.source})` : '';
        return `[${n.type}:${n.id}] "${n.name}"${via} — ${metaStr}`;
    });

    return `GATHERED CONTEXT (${gathered.nodes.length} entities, ${gathered.rounds} round(s)):

Summary: ${gathered.summary}

Entities:
${lines.join('\n')}`;
}
