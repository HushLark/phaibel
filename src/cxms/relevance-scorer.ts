// ─────────────────────────────────────────────────────────────────────────────
// CxMS RELEVANCE SCORER
// Composite relevance scoring for non-temporal context types.
//
// Nine signals, each [0, 1]. Only signals with active config are included.
// Declared weights are normalized to sum to 1.0 automatically.
//
// Signal          Source                      Needs
// ─────────────── ─────────────────────────── ──────────────────────────────
// semantic        vector cosine similarity    EmbeddingIndex + query
// recency         exponential decay (updated) node.meta.updated
// graphProximity  BFS hop distance            entity graph edges
// coOccurrence    shared edges with anchors   entity graph edges
// centrality      total degree                entity graph edges
// spatial         haversine distance          node coordinates + currentLocation
// goalAlignment   BFS to active goal node     entity graph + goal type nodes
// socialProximity BFS from "me" node (owner)  meNodeKey + entity graph edges
// behavioral      log-scale interaction freq  BehavioralIndex
// ─────────────────────────────────────────────────────────────────────────────

import type { IndexNode, IndexEdge } from '../entities/entity-index.js';
import type { RelevanceConfig } from '../entities/entity-type-config.js';
import type { BehavioralIndex } from './behavioral-index.js';

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULTS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_WEIGHTS = {
    semantic:        0.40,
    recency:         0.25,
    graphProximity:  0.20,
    coOccurrence:    0.10,
    centrality:      0.05,
};

const DEFAULT_RECENCY_HALF_LIFE   = 30;
const DEFAULT_GRAPH_DEPTH         = 2;
const DEFAULT_MAX_DISTANCE_KM     = 50;
const DEFAULT_GOAL_MAX_HOPS       = 3;
const DEFAULT_SOCIAL_MAX_HOPS     = 4;
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
    behavioralIndex?: BehavioralIndex;
    /** Composite key ("person:user-self") for the vault owner's Person node. */
    meNodeKey?: string;
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

function graphProximityScore(hops: number, maxDepth: number): number {
    if (hops === 0) return 1.0;
    if (hops === Infinity) return 0.0;
    return 1 - hops / (maxDepth + 1);
}

function coOccurrenceScore(nodeKey: string, anchorKeys: Set<string>, edges: IndexEdge[]): number {
    if (anchorKeys.size === 0) return 0;
    let shared = 0;
    for (const edge of edges) {
        const touchesNode   = edge.source === nodeKey || edge.target === nodeKey;
        const touchesAnchor = anchorKeys.has(edge.source) || anchorKeys.has(edge.target);
        if (touchesNode && touchesAnchor) shared++;
    }
    return Math.min(1, shared / Math.max(1, anchorKeys.size));
}

function centralityScore(nodeKey: string, edges: IndexEdge[], maxDegree: number): number {
    if (maxDegree === 0) return 0;
    const degree = edges.filter(e => e.source === nodeKey || e.target === nodeKey).length;
    return Math.min(1, degree / maxDegree);
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

function goalAlignmentScore(
    nodeKey: string,
    activeGoalKeys: Set<string>,
    edges: IndexEdge[],
    maxHops: number,
): number {
    if (activeGoalKeys.size === 0) return 0;
    const hops = bfsHops(nodeKey, activeGoalKeys, edges, maxHops);
    return graphProximityScore(hops, maxHops);
}

/**
 * Social proximity signal.
 * Primary: BFS distance from the vault owner's "me" node — the closer in the
 * graph, the higher the score (1 hop ≈ 0.8, 2 hops ≈ 0.6, etc.).
 * Fallback: static relationship-type weight from the entity's metadata.
 */
function socialProximityScore(
    nodeKey: string,
    meta: Record<string, unknown>,
    relationshipField: string,
    weightMap: Record<string, number>,
    ctx: ScorerContext,
): number {
    if (ctx.meNodeKey) {
        if (nodeKey === ctx.meNodeKey) return 1.0;
        const hops = bfsHops(nodeKey, new Set([ctx.meNodeKey]), ctx.edges, DEFAULT_SOCIAL_MAX_HOPS);
        if (hops !== Infinity) return graphProximityScore(hops, DEFAULT_SOCIAL_MAX_HOPS);
    }
    const rel = meta[relationshipField];
    if (typeof rel !== 'string') return 0;
    return weightMap[rel.toLowerCase()] ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// WEIGHT NORMALIZATION
// ─────────────────────────────────────────────────────────────────────────────

function buildActiveWeights(
    config: RelevanceConfig,
    hasSpatial: boolean,
    hasGoal: boolean,
    hasSocial: boolean,
    hasBehavioral: boolean,
): Record<string, number> {
    const declared = config.weights ?? {};

    // Start with always-active base signals
    const active: Record<string, number> = {
        semantic:       declared.semantic       ?? DEFAULT_WEIGHTS.semantic,
        recency:        declared.recency        ?? DEFAULT_WEIGHTS.recency,
        graphProximity: declared.graphProximity ?? DEFAULT_WEIGHTS.graphProximity,
        coOccurrence:   declared.coOccurrence   ?? DEFAULT_WEIGHTS.coOccurrence,
        centrality:     declared.centrality     ?? DEFAULT_WEIGHTS.centrality,
    };

    // Add optional signals only when configured
    if (hasSpatial)    active.spatial         = declared.spatial         ?? 0.20;
    if (hasGoal)       active.goalAlignment   = declared.goalAlignment   ?? 0.20;
    if (hasSocial)     active.socialProximity = declared.socialProximity ?? 0.20;
    if (hasBehavioral) active.behavioral      = declared.behavioral      ?? 0.15;

    // Normalize so weights sum to 1.0
    const total = Object.values(active).reduce((s, v) => s + v, 0);
    if (total === 0) return active;
    for (const k of Object.keys(active)) active[k] /= total;
    return active;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORER
// ─────────────────────────────────────────────────────────────────────────────

export function scoreNodes(
    candidates: IndexNode[],
    config: RelevanceConfig,
    ctx: ScorerContext,
): RelevanceScore[] {
    const halfLife      = config.recencyHalfLifeDays ?? DEFAULT_RECENCY_HALF_LIFE;
    const maxDepth      = config.graphDepth          ?? DEFAULT_GRAPH_DEPTH;
    const allowedRel    = config.anchorRelationships;

    // Spatial config
    const spatialCfg    = config.spatial;
    const hasSpatial    = !!(spatialCfg && ctx.currentLocation);
    const coordField    = spatialCfg?.coordinatesField ?? 'coordinates';
    const maxKm         = spatialCfg?.maxDistanceKm   ?? DEFAULT_MAX_DISTANCE_KM;

    // Goal alignment config
    const goalCfg       = config.goalAlignment;
    const hasGoal       = !!(goalCfg && ctx.activeGoalKeys && ctx.activeGoalKeys.size > 0);
    const goalMaxHops   = goalCfg?.maxHops ?? DEFAULT_GOAL_MAX_HOPS;

    // Social proximity config
    const socialCfg     = config.socialProximity;
    const hasSocial     = !!socialCfg;
    const relField      = socialCfg?.relationshipField ?? 'relationship';
    const socialWeights = { ...DEFAULT_SOCIAL_WEIGHTS, ...(socialCfg?.weights ?? {}) };

    // Behavioral config
    const hasBehavioral = !!ctx.behavioralIndex?.isLoaded;

    const weights = buildActiveWeights(config, hasSpatial, hasGoal, hasSocial, hasBehavioral);

    // Pre-compute max degree for centrality
    const degreeMap = new Map<string, number>();
    for (const edge of ctx.edges) {
        degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
        degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
    }
    const maxDegree = Math.max(0, ...degreeMap.values());

    const scores: RelevanceScore[] = candidates.map(node => {
        const key = `${node.type}:${node.id}`;

        const signals: Record<string, number> = {
            semantic:       (ctx.vectorSimilarity.get(key) ?? 0),
            recency:        recencyScore(node.meta.updated as string | undefined, halfLife, ctx.now),
            graphProximity: graphProximityScore(
                bfsHops(key, ctx.anchorKeys, ctx.edges, maxDepth, allowedRel), maxDepth
            ),
            coOccurrence:   coOccurrenceScore(key, ctx.anchorKeys, ctx.edges),
            centrality:     centralityScore(key, ctx.edges, maxDegree),
        };

        if (hasSpatial) {
            signals.spatial = spatialScore(node.meta, coordField, ctx.currentLocation!, maxKm);
        }
        if (hasGoal) {
            signals.goalAlignment = goalAlignmentScore(key, ctx.activeGoalKeys!, ctx.edges, goalMaxHops);
        }
        if (hasSocial) {
            signals.socialProximity = socialProximityScore(key, node.meta, relField, socialWeights, ctx);
        }
        if (hasBehavioral) {
            signals.behavioral = ctx.behavioralIndex!.getScore(key);
        }

        const total = Object.entries(weights).reduce(
            (sum, [k, w]) => sum + w * (signals[k] ?? 0), 0
        );

        return { key, total, signals };
    });

    return scores.sort((a, b) => b.total - a.total);
}
