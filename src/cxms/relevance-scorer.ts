// ─────────────────────────────────────────────────────────────────────────────
// CxMS RELEVANCE SCORER (v2)
// Composite relevance scoring over the canonical dimension vocabulary.
// See docs/RELEVANCE-DIMENSIONS.md.
//
// A context type opts into a subset of dimensions (RelevanceDimensionDef[]).
// Each active dimension produces a signal in [0, 1]; the score is the weighted
// sum, with per-type baseline weights modulated by per-request multipliers and
// re-normalized to sum to 1.
//
// Dimension        Anchor / source              Signal
// ─────────────── ──────────────────────────── ──────────────────────────────
// temporal         node's stored date window    graded salience curve (filter = >0)
// semantic         vector cosine similarity     EmbeddingIndex + query
// spatial          haversine distance           node coords + currentLocation
// socialProximity  BFS from the "me" node       graph + relationship refinement
// goalAlignment    BFS to active goal node      graph + active goal nodes
// behavioral       log-scale interaction freq   BehavioralIndex
// recency          exponential decay (updated)  node.meta.updated
// contextProximity BFS from current anchors     graph edges
// ─────────────────────────────────────────────────────────────────────────────

import type { IndexNode, IndexEdge } from '../entities/entity-index.js';
import type { RelevanceDimensionDef } from '../entities/entity-type-config.js';
import type { NodeDimensions } from './types.js';
import type { BehavioralIndex } from './behavioral-index.js';
import { temporalSalience, temporalExpired, todayStr } from '../entities/temporal-filter.js';
import { extractTemporalDimension } from './dimension-calculator.js';

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULTS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_RECENCY_HALF_LIFE = 30;
const DEFAULT_GRAPH_DEPTH        = 2;
const DEFAULT_MAX_DISTANCE_KM    = 50;
const DEFAULT_GOAL_MAX_HOPS      = 3;
const DEFAULT_SOCIAL_MAX_HOPS    = 4;
const DEFAULT_SOCIAL_WEIGHTS: Record<string, number> = {
    family:       1.00,
    friend:       0.75,
    colleague:    0.50,
    professional: 0.40,
    acquaintance: 0.25,
};

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface Coordinates {
    lat: number;
    lng: number;
}

export interface RelevanceScore {
    key: string;
    total: number;
    signals: Record<string, number>;
}

export interface ScorerContext {
    vectorSimilarity: Map<string, number>;
    edges: IndexEdge[];
    anchorKeys: Set<string>;
    now: Date;
    /** Today as YYYY-MM-DD, for the temporal salience curve. Defaults to now. */
    today?: string;
    currentLocation?: Coordinates;
    activeGoalKeys?: Set<string>;
    behavioralIndex?: BehavioralIndex;
    /**
     * The "me" node key — graph distance from here is the user-centric social
     * proximity signal. The caller resolves it; the scorer treats it as opaque.
     */
    focalNodeKey?: string;
}

/** Per-request weight multipliers, keyed by dimension name, centered at 1.0. */
export type RequestWeightMultipliers = Partial<Record<string, number>>;

// ─────────────────────────────────────────────────────────────────────────────
// GRAPH HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Build an adjacency map once so per-candidate BFS doesn't rescan all edges. */
interface Graph {
    adjacency: Map<string, { neighbor: string; label?: string }[]>;
    degree: Map<string, number>;
}

function buildGraph(edges: IndexEdge[]): Graph {
    const adjacency = new Map<string, { neighbor: string; label?: string }[]>();
    const degree = new Map<string, number>();
    const add = (from: string, to: string, label?: string) => {
        let list = adjacency.get(from);
        if (!list) { list = []; adjacency.set(from, list); }
        list.push({ neighbor: to, label });
        degree.set(from, (degree.get(from) ?? 0) + 1);
    };
    for (const edge of edges) {
        add(edge.source, edge.target, edge.label);
        add(edge.target, edge.source, edge.label);
    }
    return { adjacency, degree };
}

function bfsHops(
    startKey: string,
    targetKeys: Set<string>,
    graph: Graph,
    maxDepth: number,
    allowedLabels?: string[],
): number {
    if (targetKeys.has(startKey)) return 0;
    const visited = new Set<string>([startKey]);
    let frontier: string[] = [startKey];
    for (let depth = 0; depth < maxDepth; depth++) {
        const next: string[] = [];
        for (const key of frontier) {
            for (const { neighbor, label } of graph.adjacency.get(key) ?? []) {
                if (allowedLabels && label && !allowedLabels.includes(label)) continue;
                if (visited.has(neighbor)) continue;
                visited.add(neighbor);
                if (targetKeys.has(neighbor)) return depth + 1;
                next.push(neighbor);
            }
        }
        frontier = next;
    }
    return Infinity;
}

function hopsToScore(hops: number, maxDepth: number): number {
    if (hops === 0) return 1.0;
    if (hops === Infinity) return 0.0;
    return 1 - hops / (maxDepth + 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function recencyScore(updatedAt: string | undefined, halfLifeDays: number, now: Date): number {
    if (!updatedAt) return 0.5;
    const d = new Date(updatedAt);
    if (isNaN(d.getTime())) return 0.5;
    const days = (now.getTime() - d.getTime()) / 86_400_000;
    return Math.pow(0.5, days / halfLifeDays);
}

/** Haversine great-circle distance in km. */
function haversineKm(a: Coordinates, b: Coordinates): number {
    const R = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h = sinLat * sinLat +
        Math.cos((a.lat * Math.PI) / 180) *
        Math.cos((b.lat * Math.PI) / 180) *
        sinLng * sinLng;
    return 2 * R * Math.asin(Math.sqrt(h));
}

function spatialScore(
    meta: Record<string, unknown>,
    coordField: string,
    currentLocation: Coordinates,
    maxKm: number,
): number {
    const raw = meta[coordField];
    if (!raw || typeof raw !== 'object') return 0;
    const { lat, lng } = raw as Record<string, unknown>;
    if (typeof lat !== 'number' || typeof lng !== 'number') return 0;
    const km = haversineKm(currentLocation, { lat, lng });
    return Math.max(0, 1 - km / maxKm);
}

/**
 * Social / User Proximity — closeness to the user.
 * Primary: BFS hop distance from the "me" node (applies to ANY entity, not just
 * people). Refined by a relationship-type weight when the node carries one.
 */
function socialProximityScore(
    nodeKey: string,
    meta: Record<string, unknown>,
    relationshipField: string | undefined,
    weightMap: Record<string, number>,
    graph: Graph,
    focalNodeKey: string | undefined,
): number {
    let proximity = 0;
    if (focalNodeKey) {
        if (nodeKey === focalNodeKey) return 1.0;
        const hops = bfsHops(nodeKey, new Set([focalNodeKey]), graph, DEFAULT_SOCIAL_MAX_HOPS);
        if (hops !== Infinity) proximity = hopsToScore(hops, DEFAULT_SOCIAL_MAX_HOPS);
    }
    // Relationship refinement: scale graph proximity by relationship weight, or
    // fall back to the relationship weight alone when there's no graph path.
    const rel = relationshipField ? meta[relationshipField] : undefined;
    if (typeof rel === 'string') {
        const relWeight = weightMap[rel.toLowerCase()] ?? 0;
        return proximity > 0 ? proximity * relWeight : relWeight;
    }
    return proximity;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORER
// ─────────────────────────────────────────────────────────────────────────────

export function scoreNodes(
    candidates: IndexNode[],
    dimensions: RelevanceDimensionDef[],
    ctx: ScorerContext,
    requestWeights?: RequestWeightMultipliers,
): RelevanceScore[] {
    if (dimensions.length === 0) return [];

    const graph = buildGraph(ctx.edges);
    const today = ctx.today ?? todayStr();

    // Resolve baseline weights (def.weight ?? equal) modulated by per-request
    // multipliers (default 1.0), then normalize over the active dimensions.
    const weights: Record<string, number> = {};
    for (const def of dimensions) {
        const baseline = def.weight ?? 1;
        const mult = requestWeights?.[def.type] ?? 1;
        weights[def.type] = Math.max(0, baseline * mult);
    }
    const weightTotal = Object.values(weights).reduce((s, w) => s + w, 0);
    if (weightTotal > 0) {
        for (const k of Object.keys(weights)) weights[k] /= weightTotal;
    }

    const temporalDef = dimensions.find(d => d.type === 'temporal');

    const scored: (RelevanceScore | null)[] = candidates.map(node => {
        const key = `${node.type}:${node.id}`;
        const meta = node.meta as Record<string, unknown>;
        const nodeDims = (meta.dimensions ?? {}) as NodeDimensions;
        const signals: Record<string, number> = {};

        // Resolve the temporal window once (live from raw fields when the
        // precomputed dimension is absent — only cx-router's write path stores
        // it, so seeded / Feral-created / imported entities lack it).
        const tdim = temporalDef
            ? (nodeDims.temporal ?? extractTemporalDimension(meta, temporalDef.config))
            : undefined;

        for (const def of dimensions) {
            switch (def.type) {
                case 'temporal':
                    signals.temporal = temporalSalience(tdim, today);
                    break;
                case 'semantic':
                    signals.semantic = ctx.vectorSimilarity.get(key) ?? 0;
                    break;
                case 'recency':
                    signals.recency = recencyScore(
                        (meta.updated as string | undefined) ?? nodeDims.recency?.updatedAt,
                        def.config?.halfLifeDays ?? DEFAULT_RECENCY_HALF_LIFE,
                        ctx.now,
                    );
                    break;
                case 'spatial':
                    signals.spatial = ctx.currentLocation
                        ? spatialScore(meta, def.config.coordinatesField, ctx.currentLocation, def.config.maxKm ?? DEFAULT_MAX_DISTANCE_KM)
                        : 0;
                    break;
                case 'socialProximity':
                    signals.socialProximity = socialProximityScore(
                        key, meta, def.config?.field,
                        { ...DEFAULT_SOCIAL_WEIGHTS, ...(def.config?.weights ?? {}) },
                        graph, ctx.focalNodeKey,
                    );
                    break;
                case 'goalAlignment':
                    signals.goalAlignment = ctx.activeGoalKeys && ctx.activeGoalKeys.size > 0
                        ? hopsToScore(
                            bfsHops(key, ctx.activeGoalKeys, graph, def.config?.maxHops ?? DEFAULT_GOAL_MAX_HOPS),
                            def.config?.maxHops ?? DEFAULT_GOAL_MAX_HOPS,
                        )
                        : 0;
                    break;
                case 'behavioral':
                    signals.behavioral = ctx.behavioralIndex?.isLoaded ? ctx.behavioralIndex.getScore(key) : 0;
                    break;
                case 'contextProximity':
                    signals.contextProximity = ctx.anchorKeys.size > 0
                        ? hopsToScore(
                            bfsHops(key, ctx.anchorKeys, graph, def.config?.maxHops ?? DEFAULT_GRAPH_DEPTH, def.config?.followEdgeLabels),
                            def.config?.maxHops ?? DEFAULT_GRAPH_DEPTH,
                        )
                        : 0;
                    break;
            }
        }

        // Temporal candidacy filter (docs/RELEVANCE-DIMENSIONS.md §4.2), trailing
        // side only: an expired / archived node is excluded outright. Upcoming
        // nodes (before their window opens) are kept — scored low, ranked down —
        // so a task due months out still appears in "my tasks".
        if (temporalDef && temporalExpired(tdim, today)) return null;

        const total = Object.entries(weights).reduce(
            (sum, [k, w]) => sum + w * (signals[k] ?? 0), 0,
        );
        return { key, total, signals };
    });

    return scored
        .filter((s): s is RelevanceScore => s !== null)
        .sort((a, b) => b.total - a.total);
}
