// ─────────────────────────────────────────────────────────────────────────────
// CxMS RELEVANCE SCORER (v2)
// Composite relevance scoring using the 6-dimension system.
//
// Dimension       Source                      Needs
// ─────────────── ─────────────────────────── ──────────────────────────────
// semantic        vector cosine similarity    EmbeddingIndex + query
// recency         exponential decay (updated) dimensions.recency.updatedAt
// graphDistance   BFS + centrality + goal BFS entity graph edges
// socialProximity relationship-type weight    dimensions.socialProximity
// geographical    haversine distance          dimensions.geographical + location
// ─────────────────────────────────────────────────────────────────────────────

import type { IndexNode, IndexEdge } from '../entities/entity-index.js';
import type { RelevanceDimensionDef } from '../entities/entity-type-config.js';
import type { NodeDimensions } from './types.js';
import type { RequestWeights } from '../context/request-weights.js';

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULTS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_WEIGHTS: Record<string, number> = {
    semantic:        0.40,
    recency:         0.25,
    graphDistance:   0.20,
    socialProximity: 0.00,
    geographical:    0.00,
};

const DEFAULT_RECENCY_HALF_LIFE  = 30;
const DEFAULT_MAX_HOPS           = 2;
const DEFAULT_MAX_DISTANCE_KM    = 50;
const DEFAULT_GOAL_MAX_HOPS      = 3;
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
    currentLocation?: Coordinates;
    activeGoalKeys?: Set<string>;
    /** Composite key ("person:user-self") for the vault owner's Person node. */
    meNodeKey?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────

function recencySignal(updatedAt: string | undefined, halfLifeDays: number, now: Date): number {
    if (!updatedAt) return 0.5;
    const d = new Date(updatedAt);
    if (isNaN(d.getTime())) return 0.5;
    const days = (now.getTime() - d.getTime()) / 86_400_000;
    return Math.pow(0.5, days / halfLifeDays);
}

function bfsHops(
    startKey: string,
    targetKeys: Set<string>,
    edges: IndexEdge[],
    maxDepth: number,
    allowedLabels?: string[],
): number {
    if (targetKeys.has(startKey)) return 0;
    const visited = new Set<string>([startKey]);
    const queue: { key: string; depth: number }[] = [{ key: startKey, depth: 0 }];
    while (queue.length > 0) {
        const { key, depth } = queue.shift()!;
        if (depth >= maxDepth) continue;
        for (const edge of edges) {
            if (edge.source !== key && edge.target !== key) continue;
            if (allowedLabels && edge.label && !allowedLabels.includes(edge.label)) continue;
            const neighbor = edge.source === key ? edge.target : edge.source;
            if (visited.has(neighbor)) continue;
            visited.add(neighbor);
            if (targetKeys.has(neighbor)) return depth + 1;
            queue.push({ key: neighbor, depth: depth + 1 });
        }
    }
    return Infinity;
}

function proximitySignal(hops: number, maxDepth: number): number {
    if (hops === 0) return 1.0;
    if (hops === Infinity) return 0.0;
    return 1 - hops / (maxDepth + 1);
}

function haversineKm(a: Coordinates, b: Coordinates): number {
    const R = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const s1 = Math.sin(dLat / 2);
    const s2 = Math.sin(dLng / 2);
    const h = s1 * s1 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * s2 * s2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

// ─────────────────────────────────────────────────────────────────────────────
// DIMENSION SIGNAL COMPUTERS
// ─────────────────────────────────────────────────────────────────────────────

function semanticSignal(key: string, ctx: ScorerContext): number {
    return ctx.vectorSimilarity.get(key) ?? 0;
}

function recencyDimSignal(
    dims: NodeDimensions,
    halfLifeDays: number,
    now: Date,
): number {
    return recencySignal(dims.recency?.updatedAt, halfLifeDays, now);
}

function graphDistanceSignal(
    key: string,
    dims: NodeDimensions,
    ctx: ScorerContext,
    maxHops: number,
    allowedLabels: string[] | undefined,
    maxDegree: number,
): number {
    // Proximity to current query anchors
    const anchorHops = bfsHops(key, ctx.anchorKeys, ctx.edges, maxHops, allowedLabels);
    const anchorProximity = proximitySignal(anchorHops, maxHops);

    // Centrality (normalized degree)
    const degree = dims.graphDistance?.degree ?? 0;
    const centrality = maxDegree > 0 ? Math.min(1, degree / maxDegree) : 0;

    // Goal alignment (BFS to active goal nodes)
    let goalScore = 0;
    if (ctx.activeGoalKeys && ctx.activeGoalKeys.size > 0) {
        const goalHops = bfsHops(key, ctx.activeGoalKeys, ctx.edges, DEFAULT_GOAL_MAX_HOPS);
        goalScore = proximitySignal(goalHops, DEFAULT_GOAL_MAX_HOPS);
    }

    const hasGoal = goalScore > 0;
    const totalWeight = 0.6 + 0.25 + (hasGoal ? 0.15 : 0);
    return (anchorProximity * 0.6 + centrality * 0.25 + goalScore * (hasGoal ? 0.15 : 0)) / totalWeight;
}

function socialProximitySignal(
    key: string,
    dims: NodeDimensions,
    ctx: ScorerContext,
    weightMap: Record<string, number>,
): number {
    // Graph-based: BFS distance from the "me" node (vault owner).
    // 0 hops = this IS the me node (1.0); 1 hop = direct contact (0.8); etc.
    if (ctx.meNodeKey) {
        if (key === ctx.meNodeKey) return 1.0;
        const hops = bfsHops(key, new Set([ctx.meNodeKey]), ctx.edges, 4);
        if (hops !== Infinity) return proximitySignal(hops, 4);
    }
    // Fallback: static relationship-type weight from entity metadata
    const rel = dims.socialProximity?.relationship;
    if (!rel) return 0;
    return weightMap[rel.toLowerCase()] ?? 0;
}

function geographicalSignal(
    dims: NodeDimensions,
    currentLocation: Coordinates,
    maxKm: number,
): number {
    const geo = dims.geographical;
    if (!geo) return 0;
    const km = haversineKm(currentLocation, geo);
    return Math.max(0, 1 - km / maxKm);
}

// ─────────────────────────────────────────────────────────────────────────────
// WEIGHT NORMALIZATION
// ─────────────────────────────────────────────────────────────────────────────

function buildWeights(
    dimensions: RelevanceDimensionDef[],
    hasSocial: boolean,
    hasGeo: boolean,
): Record<string, number> {
    const raw: Record<string, number> = { ...DEFAULT_WEIGHTS };

    for (const def of dimensions) {
        if (def.type === 'temporal') continue; // not a scorer dimension
        if (def.weight !== undefined) raw[def.type] = def.weight;
    }

    if (!hasSocial) raw.socialProximity = 0;
    if (!hasGeo)    raw.geographical    = 0;

    const total = Object.values(raw).reduce((s, v) => s + v, 0);
    if (total === 0) return raw;
    const normalized: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) normalized[k] = v / total;
    return normalized;
}

// ─────────────────────────────────────────────────────────────────────────────
// REQUEST-WEIGHT OVERLAY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply per-request weight overrides on top of per-type dimension weights.
 *
 * Only dimensions already active in the type config (weight > 0) are eligible
 * for a request boost — we never activate an unconfigured dimension at query
 * time.  The active set is re-normalized after applying request weights.
 */
function applyRequestWeights(
    typeWeights: Record<string, number>,
    rw: Partial<RequestWeights>,
): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [k, w] of Object.entries(typeWeights)) {
        if (w <= 0) {
            result[k] = 0;
            continue;
        }
        // Substitute the request weight for this dimension (or keep type default)
        const rwVal = (rw as Record<string, number>)[k];
        result[k] = rwVal !== undefined ? rwVal : w;
    }
    const total = Object.values(result).reduce((s, v) => s + v, 0);
    if (total === 0) return typeWeights;
    const norm: Record<string, number> = {};
    for (const [k, v] of Object.entries(result)) norm[k] = v / total;
    return norm;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCORER
// ─────────────────────────────────────────────────────────────────────────────

export function scoreNodes(
    candidates: IndexNode[],
    dimensions: RelevanceDimensionDef[],
    ctx: ScorerContext,
    requestWeights?: Partial<RequestWeights>,
): RelevanceScore[] {
    // Extract per-dimension configs
    const recencyDef    = dimensions.find(d => d.type === 'recency');
    const graphDef      = dimensions.find(d => d.type === 'graphDistance');
    const socialDef     = dimensions.find(d => d.type === 'socialProximity');
    const geoDef        = dimensions.find(d => d.type === 'geographical');

    const halfLife      = (recencyDef?.type === 'recency' ? recencyDef.config?.halfLifeDays : undefined) ?? DEFAULT_RECENCY_HALF_LIFE;
    const maxHops       = (graphDef?.type === 'graphDistance' ? graphDef.config?.maxHops : undefined) ?? DEFAULT_MAX_HOPS;
    const allowedLabels = graphDef?.type === 'graphDistance' ? graphDef.config?.followEdgeLabels : undefined;
    const socialWeights = { ...DEFAULT_SOCIAL_WEIGHTS, ...(socialDef?.type === 'socialProximity' ? (socialDef.config.weights ?? {}) : {}) };
    const maxKm         = (geoDef?.type === 'geographical' ? geoDef.config.maxKm : undefined) ?? DEFAULT_MAX_DISTANCE_KM;

    const hasSocial = !!socialDef;
    const hasGeo    = !!(geoDef && ctx.currentLocation);

    const typeWeights = buildWeights(dimensions, hasSocial, hasGeo);
    const weights = requestWeights
        ? applyRequestWeights(typeWeights, requestWeights)
        : typeWeights;

    // Pre-compute max degree for centrality
    const degreeMap = new Map<string, number>();
    for (const edge of ctx.edges) {
        degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
        degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
    }
    const maxDegree = Math.max(0, ...degreeMap.values());

    const scores: RelevanceScore[] = candidates.map(node => {
        const key  = `${node.type}:${node.id}`;
        const dims = (node.meta.dimensions ?? {}) as NodeDimensions;

        const signals: Record<string, number> = {
            semantic:      semanticSignal(key, ctx),
            recency:       recencyDimSignal(dims, halfLife, ctx.now),
            graphDistance: graphDistanceSignal(key, dims, ctx, maxHops, allowedLabels, maxDegree),
        };

        if (hasSocial) {
            signals.socialProximity = socialProximitySignal(key, dims, ctx, socialWeights);
        }
        if (hasGeo) {
            signals.geographical = geographicalSignal(dims, ctx.currentLocation!, maxKm);
        }

        const total = Object.entries(weights).reduce(
            (sum, [k, w]) => sum + w * (signals[k] ?? 0), 0,
        );

        return { key, total, signals };
    });

    return scores.sort((a, b) => b.total - a.total);
}
