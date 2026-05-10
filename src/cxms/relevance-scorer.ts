// ─────────────────────────────────────────────────────────────────────────────
// CxMS RELEVANCE SCORER
// Composite relevance scoring for non-temporal context types.
//
// Combines five signals into a single [0, 1] score:
//   semantic      — vector cosine similarity between node and query
//   recency       — exponential decay from last-updated timestamp
//   graphProximity — inverse hop distance from anchor nodes
//   coOccurrence  — edge count with other relevant nodes
//   centrality    — total degree of the node in the entity graph
//
// Weights and decay parameters come from the type's RelevanceConfig in CxMS.
// All computation is local — no LLM calls.
// ─────────────────────────────────────────────────────────────────────────────

import type { IndexNode, IndexEdge } from '../entities/entity-index.js';
import type { RelevanceConfig } from '../entities/entity-type-config.js';

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULTS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_WEIGHTS = {
    semantic:       0.40,
    recency:        0.25,
    graphProximity: 0.20,
    coOccurrence:   0.10,
    centrality:     0.05,
};

const DEFAULT_RECENCY_HALF_LIFE_DAYS = 30;
const DEFAULT_GRAPH_DEPTH = 2;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface RelevanceScore {
    key: string;
    total: number;           // composite [0, 1]
    signals: {
        semantic:       number;
        recency:        number;
        graphProximity: number;
        coOccurrence:   number;
        centrality:     number;
    };
}

export interface ScorerContext {
    /** Cosine similarity for each node key — from EmbeddingIndex */
    vectorSimilarity: Map<string, number>;
    /** All edges in the entity graph */
    edges: IndexEdge[];
    /** Keys of anchor nodes (already-fetched relevant nodes) */
    anchorKeys: Set<string>;
    /** Today's date for recency computation */
    now: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function recencyScore(updatedAt: string | undefined, halfLifeDays: number, now: Date): number {
    if (!updatedAt) return 0.5; // unknown recency — neutral
    const updated = new Date(updatedAt);
    if (isNaN(updated.getTime())) return 0.5;
    const daysSince = (now.getTime() - updated.getTime()) / 86_400_000;
    return Math.pow(0.5, daysSince / halfLifeDays);
}

/**
 * BFS from anchor keys up to maxDepth hops. Returns closest hop distance
 * to any anchor node, or Infinity if unreachable.
 */
function shortestHopToAnchor(
    nodeKey: string,
    anchorKeys: Set<string>,
    edges: IndexEdge[],
    maxDepth: number,
    allowedLabels?: string[],
): number {
    if (anchorKeys.has(nodeKey)) return 0;

    const visited = new Set<string>([nodeKey]);
    const queue: { key: string; depth: number }[] = [{ key: nodeKey, depth: 0 }];

    while (queue.length > 0) {
        const { key, depth } = queue.shift()!;
        if (depth >= maxDepth) continue;

        for (const edge of edges) {
            if (edge.source !== key && edge.target !== key) continue;
            if (allowedLabels && edge.label && !allowedLabels.includes(edge.label)) continue;

            const neighbor = edge.source === key ? edge.target : edge.source;
            if (visited.has(neighbor)) continue;
            visited.add(neighbor);

            if (anchorKeys.has(neighbor)) return depth + 1;
            queue.push({ key: neighbor, depth: depth + 1 });
        }
    }

    return Infinity;
}

function graphProximityScore(hops: number, maxDepth: number): number {
    if (hops === 0) return 1.0;
    if (hops === Infinity) return 0.0;
    return 1 - (hops / (maxDepth + 1));
}

function coOccurrenceScore(nodeKey: string, anchorKeys: Set<string>, edges: IndexEdge[]): number {
    if (anchorKeys.size === 0) return 0;
    let sharedEdges = 0;
    for (const edge of edges) {
        const touchesNode = edge.source === nodeKey || edge.target === nodeKey;
        const touchesAnchor = anchorKeys.has(edge.source) || anchorKeys.has(edge.target);
        if (touchesNode && touchesAnchor) sharedEdges++;
    }
    return Math.min(1, sharedEdges / Math.max(1, anchorKeys.size));
}

function centralityScore(nodeKey: string, edges: IndexEdge[], maxDegree: number): number {
    if (maxDegree === 0) return 0;
    const degree = edges.filter(e => e.source === nodeKey || e.target === nodeKey).length;
    return Math.min(1, degree / maxDegree);
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Score a set of candidate nodes for relevance using the type's RelevanceConfig.
 * Returns scores sorted descending by total.
 */
export function scoreNodes(
    candidates: IndexNode[],
    config: RelevanceConfig,
    ctx: ScorerContext,
): RelevanceScore[] {
    const weights = {
        semantic:       config.weights?.semantic       ?? DEFAULT_WEIGHTS.semantic,
        recency:        config.weights?.recency        ?? DEFAULT_WEIGHTS.recency,
        graphProximity: config.weights?.graphProximity ?? DEFAULT_WEIGHTS.graphProximity,
        coOccurrence:   config.weights?.coOccurrence   ?? DEFAULT_WEIGHTS.coOccurrence,
        centrality:     config.weights?.centrality     ?? DEFAULT_WEIGHTS.centrality,
    };

    const halfLife   = config.recencyHalfLifeDays ?? DEFAULT_RECENCY_HALF_LIFE_DAYS;
    const maxDepth   = config.graphDepth          ?? DEFAULT_GRAPH_DEPTH;
    const allowedRel = config.anchorRelationships;

    // Pre-compute max degree for centrality normalisation
    const degreeMap = new Map<string, number>();
    for (const edge of ctx.edges) {
        degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
        degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
    }
    const maxDegree = Math.max(0, ...degreeMap.values());

    const scores: RelevanceScore[] = candidates.map(node => {
        const key = `${node.type}:${node.id}`;

        const sem  = ctx.vectorSimilarity.get(key) ?? 0;
        const rec  = recencyScore(node.meta.updated as string | undefined, halfLife, ctx.now);
        const hops = shortestHopToAnchor(key, ctx.anchorKeys, ctx.edges, maxDepth, allowedRel);
        const prox = graphProximityScore(hops, maxDepth);
        const cooc = coOccurrenceScore(key, ctx.anchorKeys, ctx.edges);
        const cent = centralityScore(key, ctx.edges, maxDegree);

        const total =
            sem  * weights.semantic +
            rec  * weights.recency +
            prox * weights.graphProximity +
            cooc * weights.coOccurrence +
            cent * weights.centrality;

        return {
            key,
            total,
            signals: { semantic: sem, recency: rec, graphProximity: prox, coOccurrence: cooc, centrality: cent },
        };
    });

    return scores.sort((a, b) => b.total - a.total);
}
