// ─────────────────────────────────────────────────────────────────────────────
// REQUEST WEIGHTS
// Derive per-dimension weight multipliers from a ClassificationResult.
//
// Each context type stores baseline dimension weights (structural defaults, see
// docs/RELEVANCE-DIMENSIONS.md §3). These per-request multipliers shift that
// balance for a given query: a person mention amplifies social proximity, a
// future-date query suppresses recency, an analytical query boosts semantic.
//
// Multipliers are centered at 1.0 (neutral). The scorer multiplies each active
// dimension's baseline weight by its multiplier and re-normalizes; a dimension
// absent from the map is left neutral. Keyed by the canonical dimension names.
//
// Pure and deterministic: a rule-based function of the classification — no LLM.
// ─────────────────────────────────────────────────────────────────────────────

import type { ClassificationResult } from './request-classifier.js';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type RelevanceDimensionName =
    | 'temporal' | 'semantic' | 'spatial' | 'socialProximity'
    | 'goalAlignment' | 'behavioral' | 'recency' | 'contextProximity';

/** Per-request weight multipliers, centered at 1.0. Absent dimensions = neutral. */
export type RequestWeights = Partial<Record<RelevanceDimensionName, number>>;

/** A targeted entity fetch derived from a ClassificationResult. */
export interface ClassificationFetchRequest {
    /** Entity type to filter on. Omit for cross-type search. */
    entityType?: string;
    /** Search query (subject text + optional ISO date). */
    query: string;
    /** Max results to return for this request. */
    limit: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// WEIGHT INFERENCE
// ─────────────────────────────────────────────────────────────────────────────

/** Clamp a multiplier to a sane range so one query can't fully zero a dimension. */
function clampMult(v: number): number {
    return Math.max(0.25, Math.min(3, v));
}

/**
 * Derive per-dimension weight multipliers from a ClassificationResult.
 *
 * Multipliers are applied over each context type's baseline dimension weights
 * in the scorer (active dimensions only), then re-normalized. 1.0 is neutral;
 * dimensions not mentioned here are left at 1.0.
 *
 * Examples:
 *   "what am I doing tomorrow?"    → recency↓, contextProximity↑
 *   "when am I meeting Bob next?"  → socialProximity↑↑, contextProximity↑, recency↓
 *   "am I making progress?"        → semantic↑, recency↑ (pattern analysis)
 */
export function inferWeights(classification: ClassificationResult): RequestWeights {
    const m: Record<RelevanceDimensionName, number> = {
        temporal: 1, semantic: 1, spatial: 1, socialProximity: 1,
        goalAlignment: 1, behavioral: 1, recency: 1, contextProximity: 1,
    };

    const { timeframes, subjects, attributes, category } = classification;

    // ── Person mention → social + context matter more ────────────────────
    const hasPerson = subjects.some(s =>
        s.entityType === 'person' ||
        (!s.entityType &&
            /\b(my |boss|friend|colleague|partner|mom|dad|mother|father|sister|brother|uncle|aunt|son|daughter)\b/i.test(s.text))
    );
    if (hasPerson) {
        m.socialProximity  *= 2.0;
        m.contextProximity *= 1.3;
        m.semantic         *= 0.8;
        m.recency          *= 0.85;
    }

    // ── Task/event subject → context links + goal matter, semantic less so ─
    if (subjects.some(s => s.entityType === 'task' || s.entityType === 'event')) {
        m.contextProximity *= 1.2;
        m.goalAlignment    *= 1.2;
        m.semantic         *= 0.9;
    }

    // ── Future timeframe → recency suppressed (a task due next week is fine)
    if (timeframes.some(t => t.direction === 'future')) {
        m.recency          *= 0.6;
        m.semantic         *= 1.1;
        m.contextProximity *= 1.1;
    }

    // ── Past timeframe → recency matters (what happened recently?) ────────
    if (timeframes.some(t => t.direction === 'past')) {
        m.recency  *= 1.3;
        m.semantic *= 1.05;
    }

    // ── Urgency → recency + behavioral bump ───────────────────────────────
    if (attributes.some(a =>
        ['urgent', 'overdue', 'high priority', 'important', 'critical'].some(u =>
            a.text.toLowerCase().includes(u)))) {
        m.recency    *= 1.3;
        m.behavioral *= 1.2;
    }

    // ── Category adjustments ──────────────────────────────────────────────
    switch (category) {
        case 'analytical':
            m.semantic         *= 1.25;
            m.recency          *= 1.25;
            m.contextProximity *= 0.8;
            break;
        case 'introspection':
            m.semantic         *= 1.35;
            m.contextProximity *= 1.2;
            m.socialProximity  *= 1.2;
            m.behavioral       *= 1.3;
            m.recency          *= 0.7;
            break;
        case 'remember':
        case 'task':
            m.semantic         *= 1.1;
            m.contextProximity *= 1.15;
            m.recency          *= 0.9;
            break;
        case 'create':
            m.semantic         *= 1.25;
            m.recency          *= 1.1;
            m.contextProximity *= 0.9;
            break;
        default:
            break;
    }

    const out: RequestWeights = {};
    for (const k of Object.keys(m) as RelevanceDimensionName[]) out[k] = clampMult(m[k]);
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// FETCH REQUEST BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build targeted CxMS fetch requests from a ClassificationResult.
 *
 * One request per subject with a known entity type, plus an isoDate suffix
 * when the classification extracted a specific date.  Falls back to a single
 * general query using the classification summary.
 */
export function buildFetchRequests(
    classification: ClassificationResult,
): ClassificationFetchRequest[] {
    const requests: ClassificationFetchRequest[] = [];
    const primaryDate = classification.timeframes.find(t => t.isoDate)?.isoDate;
    const dateTag = primaryDate ? ` ${primaryDate}` : '';

    // For analytical/introspection, "today" is reasoning context, not a strict
    // date filter.  Suppressing the date tag lets fulfillRequests fetch the full
    // entity list so the LLM can reason about priorities, patterns, etc.
    // For query/task/remember categories, date filtering is intentional (e.g.
    // "what events do I have tomorrow?" should narrow to that specific day).
    const suppressDate = classification.category === 'analytical' || classification.category === 'introspection';

    for (const subject of classification.subjects) {
        // When subject text is just the entity type name (singular or plural),
        // it carries no keyword signal — use only the date tag (or empty string)
        // so fulfillRequests falls back to getNodes(typeKey) for the full list.
        const typeAlias = subject.entityType
            ? [subject.entityType, subject.entityType + 's']
            : [];
        const isTypeAlias = typeAlias.some(a => a.toLowerCase() === subject.text.toLowerCase().trim());
        const keywordPart = isTypeAlias ? '' : subject.text;
        // Only append the date when the keyword part is empty (pure type-alias
        // query).  If there's a real keyword ("focus/priorities"), appending a date
        // would trigger the date filter in fulfillRequests and over-restrict results.
        const effectiveDateTag = (keywordPart || suppressDate) ? '' : dateTag;

        requests.push({
            entityType: subject.entityType,
            query:      (keywordPart + effectiveDateTag).trim() || classification.summary,
            limit:      12,
        });
    }

    // Fallback when no specific subjects were extracted
    if (requests.length === 0) {
        if (classification.category === 'analytical' || classification.category === 'introspection') {
            // Broad multi-type fetch: pull the main operational entity types so the
            // LLM has real data to analyze.  Date tag applied to each type so temporal
            // filtering narrows to the relevant window when a date was present.
            for (const et of ['task', 'event', 'goal', 'note']) {
                // Empty query → fulfillRequests uses getNodes(type), returning all
                // entities of this type.  The LLM reasons about dates; we don't
                // pre-filter because the question spans all time (e.g. overdue tasks).
                requests.push({ entityType: et, query: '', limit: 10 });
            }
        } else {
            requests.push({
                query: classification.summary + dateTag,
                limit: 15,
            });
        }
    }

    // If we only have a person subject, add a secondary event/task search
    // so "meeting with Bob" also finds the calendar event, not just Bob's node.
    if (requests.length === 1 && requests[0].entityType === 'person') {
        requests.push({
            query: classification.summary + dateTag,
            limit: 10,
        });
    }

    return requests;
}
