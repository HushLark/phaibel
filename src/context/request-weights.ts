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

    // Fallback when no specific subjects were extracted: pull the operational
    // types broadly so even a vague query ("what should I do?", "anything I'm
    // missing?") has real context. These types declare relevance dimensions, so
    // an empty query is ranked by temporal/recency rather than returning nothing
    // (a summary keyword search alone usually whiffs — that was a dead end).
    if (requests.length === 0) {
        requests.push(...buildBroadFallbackRequests(classification));
    }

    // Cross-type recall companion. Per-subject requests are scoped to the
    // subject's type, which silently drops answers that live in a DIFFERENT type
    // — e.g. "what's Emma allergic to" types Emma as a person and never searches
    // the NOTE that holds the allergy; "meeting with Bob" finds Bob but not the
    // event. When any subject was typed, add an untyped search so semantic
    // matches in any type surface alongside the typed results. Dedup + the
    // maxNodes cap in fetchContextByClassification bound the total.
    const hasTypedSubject = classification.subjects.some(s => s.entityType);
    if (hasTypedSubject) {
        // Use the subject text (high-signal keywords like "Emma"), not the full
        // summary sentence — keyword search is AND-matched, so a natural-language
        // sentence ("what is emma allergic to") rarely matches a short note.
        const recallQuery = classification.subjects.map(s => s.text).join(' ').trim()
            || classification.summary;
        requests.push({ query: recallQuery, limit: 10 });
    }

    return requests;
}

/**
 * Broad cross-type requests used when subject-scoped retrieval has nothing to
 * go on — either no subjects were extracted, or every typed search whiffed
 * (a wrong entityType from the classifier must not zero out retrieval; the
 * answer often lives in a different type, e.g. a birthday in a NOTE while the
 * subject was typed as a PERSON).
 */
export function buildBroadFallbackRequests(
    classification: ClassificationResult,
): ClassificationFetchRequest[] {
    const requests: ClassificationFetchRequest[] = [];
    for (const et of ['task', 'event', 'goal', 'note', 'person']) {
        requests.push({ entityType: et, query: '', limit: 8 });
    }
    if (classification.summary.trim()) {
        // Cross-type keyword pass for any semantic match the broad fetch missed.
        requests.push({ query: classification.summary, limit: 10 });
    }
    return requests;
}
