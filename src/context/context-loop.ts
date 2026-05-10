import type { LLMProvider } from '../llm/types.js';
import type { EntityIndex, IndexNode } from '../entities/entity-index.js';
import type { IntentResult } from './intent-classifier.js';
import type { ContextManifest } from './context-manifest.js';
import { serializeManifest } from './context-manifest.js';
import { parseJsonResponse } from '../utils/json-parser.js';
import { loadEntityTypes } from '../entities/entity-type-config.js';
import { debug } from '../utils/debug.js';

export interface FetchRequest {
    type: string;
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
            const newNodes = await fulfillRequests(decision.requests, entityIndex, anchorKeys);
            let added = 0;
            for (const node of newNodes) {
                if (!fetched.some(n => n.type === node.type && n.id === node.id)) {
                    fetched.push(node);
                    added++;
                }
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

export async function fulfillRequests(
    requests: FetchRequest[],
    entityIndex: EntityIndex,
    anchorKeys: Set<string> = new Set(),
): Promise<IndexNode[]> {
    const entityTypes = await loadEntityTypes();
    const typeConfigMap = new Map(entityTypes.map(t => [t.name, t]));

    const results: IndexNode[] = [];
    for (const req of requests) {
        if (req.ids && req.ids.length > 0) {
            for (const id of req.ids) {
                const node = entityIndex.getNode(`${req.type}:${id}`);
                if (node) results.push(node);
            }
            continue;
        }

        const query = req.query ?? '';
        const limit = req.limit ?? 10;
        const typeConfig = typeConfigMap.get(req.type);

        // Date-based filter: if query contains YYYY-MM-DD, match against entity meta
        const dateMatch = query.match(DATE_PATTERN);
        if (dateMatch) {
            const targetDate = dateMatch[1];
            const found = entityIndex.getNodes(req.type)
                .filter(n => Object.values(n.meta).some(v =>
                    typeof v === 'string' && v.startsWith(targetDate)
                ))
                .slice(0, limit);
            results.push(...found);
            continue;
        }

        // Relevance-scored fetch: used when the type has a RelevanceConfig and no date filter
        if (typeConfig?.relevance && !typeConfig.temporal) {
            try {
                const scored = await entityIndex.searchByRelevance(
                    query,
                    req.type as import('../entities/entity.js').EntityTypeName,
                    anchorKeys,
                    typeConfig.relevance,
                );
                results.push(...scored.slice(0, limit).map(r => r.node));
                continue;
            } catch (err) {
                debug('context-loop', `Relevance scoring failed for ${req.type}, falling back: ${err}`);
            }
        }

        if (query) {
            const found = entityIndex.search(query, req.type).slice(0, limit);
            results.push(...found.map(r => r.node));
        } else {
            const found = entityIndex.getNodes(req.type).slice(0, limit);
            results.push(...found);
        }
    }
    return results;
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
        return `[${n.type}:${n.id}] "${n.name}" — ${metaStr}`;
    });

    return `GATHERED CONTEXT (${gathered.nodes.length} entities, ${gathered.rounds} round(s)):

Summary: ${gathered.summary}

Entities:
${lines.join('\n')}`;
}
