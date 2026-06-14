// ─────────────────────────────────────────────────────────────────────────────
// PHAIBEL DOMAIN — Life Primitives (base categories)
//
// This is Phaibel's specific instantiation of CxMS's generic context-type model.
// CxMS provides the machinery: context types, subtypes (`parent`), the relevance
// dimension vocabulary, inheritance (resolveDimensions), and specificity
// (getSpecificity) — all domain-agnostic. THIS file supplies the domain: the six
// life primitives a person's world is made of, and the default relevance profile
// for each. CxMS never references these values; only Phaibel does.
//
// See docs/RELEVANCE-DIMENSIONS.md (Life Primitives + Relevance Layers).
// ─────────────────────────────────────────────────────────────────────────────

import {
    resolveDimensions,
    type EntityTypeConfig,
    type RelevanceDimensionDef,
} from './entity-type-config.js';

/**
 * The six base categories — Phaibel's top-level ontology of a person's life:
 *   person — people
 *   place  — locations
 *   thing  — objects, notes, documents, records
 *   event  — period-anchored happenings you attend (duration)
 *   task   — point-anchored actions you complete (a checkbox with a deadline)
 *   goal   — what you're working toward (the "why"; a hub for alignment)
 */
export type BaseCategory = 'person' | 'place' | 'thing' | 'event' | 'task' | 'goal';

export const BASE_CATEGORIES: BaseCategory[] = ['person', 'place', 'thing', 'event', 'task', 'goal'];

/**
 * Default relevance profile per base category (docs/RELEVANCE-DIMENSIONS.md §3).
 * A type with no own/inherited `dimensions` falls back to its category's profile.
 */
export const BASE_CATEGORY_DIMENSIONS: Record<BaseCategory, RelevanceDimensionDef[]> = {
    person: [
        { type: 'socialProximity',  weight: 3, config: { field: 'type' } },
        { type: 'behavioral',       weight: 3 },
        { type: 'semantic',         weight: 2 },
        { type: 'contextProximity', weight: 2 },
        { type: 'recency',          weight: 2 },
        { type: 'goalAlignment',    weight: 1 },
    ],
    place: [
        { type: 'spatial',          weight: 3, config: { coordinatesField: 'coordinates' } },
        { type: 'behavioral',       weight: 2 },
        { type: 'semantic',         weight: 2 },
        { type: 'socialProximity',  weight: 1 },
        { type: 'recency',          weight: 1 },
        { type: 'contextProximity', weight: 1 },
    ],
    thing: [
        { type: 'semantic',         weight: 3 },
        { type: 'contextProximity', weight: 3 },
        { type: 'goalAlignment',    weight: 2 },
        { type: 'behavioral',       weight: 2 },
        { type: 'recency',          weight: 2 },
        { type: 'socialProximity',  weight: 1 },
    ],
    event: [
        { type: 'temporal',         weight: 3, config: { anchor: 'period', startField: 'startDate', durationField: 'duration', windowBefore: 3, windowAfter: 14, archiveDelay: 30 } },
        { type: 'spatial',          weight: 2, config: { coordinatesField: 'coordinates' } },
        { type: 'socialProximity',  weight: 2 },
        { type: 'semantic',         weight: 2 },
        { type: 'recency',          weight: 2 },
        { type: 'contextProximity', weight: 2 },
        { type: 'goalAlignment',    weight: 1 },
        { type: 'behavioral',       weight: 1 },
    ],
    task: [
        { type: 'temporal',         weight: 3, config: { anchor: 'point', startField: 'dueDate', windowBefore: 2, windowAfter: 60 } },
        { type: 'goalAlignment',    weight: 3 },
        { type: 'semantic',         weight: 2 },
        { type: 'contextProximity', weight: 2 },
        { type: 'recency',          weight: 2 },
        { type: 'socialProximity',  weight: 1 },
        { type: 'behavioral',       weight: 1 },
    ],
    goal: [
        // Long-horizon and persistent: low recency, no window; a hub other
        // entities link to, so context proximity dominates.
        { type: 'contextProximity', weight: 3 },
        { type: 'semantic',         weight: 2 },
        { type: 'recency',          weight: 1 },
        { type: 'behavioral',       weight: 1 },
    ],
};

/**
 * Domain dimension resolution: the generic own→parent inheritance (CxMS), then
 * a Phaibel-specific fallback to the type's base-category profile. This is what
 * the scoring pipeline should call so an unconfigured type still scores sensibly.
 */
export function resolveDomainDimensions(
    cfg: EntityTypeConfig | undefined,
    byName: Map<string, EntityTypeConfig>,
): RelevanceDimensionDef[] {
    const inherited = resolveDimensions(cfg, byName);
    if (inherited.length > 0) return inherited;
    const cat = cfg?.baseCategory as BaseCategory | undefined;
    return cat ? (BASE_CATEGORY_DIMENSIONS[cat] ?? []) : [];
}
