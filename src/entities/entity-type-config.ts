// ─────────────────────────────────────────────────────────────────────────────
// ENTITY TYPE CONFIG (Phaibel domain over CxMS)
// Built-in types come from code (DEFAULT_ENTITY_TYPES). User-created types are
// directory-native: each lives in (Foundation)/context-types/{name}/.cxms.md,
// holding its full config in frontmatter alongside its nodes. There is no
// central registry file — persistence is delegated to the CxMS context-type
// store (imported dynamically to avoid an import cycle).
// ─────────────────────────────────────────────────────────────────────────────

import { getPlatform } from '../platform/index.js';
import { DEFAULT_ENTITY_TYPES, BUILT_IN_TYPE_NAMES } from './entity-types-defaults.js';
import { debug } from '../utils/debug.js';
import { getVaultRoot } from '../state/manager.js';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type FieldType =
    | 'string' | 'number' | 'boolean'
    | 'date' | 'datetime' | 'duration' | 'time'
    | 'date-fixed' | 'date-floating'
    | 'reference'
    | 'enum' | 'array' | 'object';

export interface FieldDef {
    key: string;
    type: FieldType;
    label?: string;
    required?: boolean;
    default?: unknown;
    values?: string[];          // for enum fields
    targetType?: string;        // for reference fields — which entity type to target
}

/** Maps a field from the template entity to the spawned child entity */
export interface FieldMapping {
    from?: string;              // field key on template entity (copy value from)
    to?: string;                // field key on child entity (write value to)
    target?: string;            // alias for 'to' (alternative syntax)
    value?: string;             // literal value or '{date}' / '{title}' token
    default?: unknown;          // fallback if 'from' field is absent
}

export interface DateSeriesScheduling {
    cadenceField: string;           // field holding 'daily'|'weekly'|'monthly'
    cadenceDetailsField: string;    // field holding CadenceDetails object
    blackoutField: string;          // field holding BlackoutWindow[]
}

export interface SpawnerConfig {
    mode: 'date-series' | 'template';
    targetTypeField?: string;       // field on template that names the target entity type
    titlePattern?: string;          // e.g. "{title} — {YYYY-MM-DD}"
    dedupeFields?: string[];        // fields used to detect already-spawned entities
    scheduling?: DateSeriesScheduling;
    fieldMapping?: FieldMapping[];
    childrenField?: string;         // for template mode: field holding child specs array
}

// ─────────────────────────────────────────────────────────────────────────────
// TEMPORAL CONFIG
// Defines how a context type relates to time: which field holds the date,
// how wide the window of importance is around that date, and when nodes
// should be automatically archived after they expire.
// ─────────────────────────────────────────────────────────────────────────────

export type TemporalAnchor = 'date' | 'datetime' | 'daterange';

export interface TemporalConfig {
    /** Which temporal construct this type uses */
    anchor: TemporalAnchor;

    /** Frontmatter field holding the primary date or datetime value */
    field: string;

    /**
     * For 'daterange': the end date/datetime field.
     * Window relevance is measured from the START date (field), not end.
     */
    endField?: string;

    /** For 'daterange': duration field, used when endField is absent */
    durationField?: string;

    /**
     * Window of importance relative to today.
     * A node is considered relevant when:
     *   today ∈ [node.date − windowDaysBefore,  node.date + windowDaysAfter]
     *
     * Examples:
     *   Executive calendar: windowDaysBefore=7,  windowDaysAfter=14
     *   Soccer season:      windowDaysBefore=14, windowDaysAfter=120
     *   TV show premiere:   windowDaysBefore=0,  windowDaysAfter=3
     */
    windowDaysBefore: number;
    windowDaysAfter: number;

    /**
     * Days after the anchor date to move the node to .archive/.
     * Undefined = never auto-archive.
     * The archive cron job runs daily and moves expired nodes.
     */
    deleteAfterDays?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// RELEVANCE DIMENSION DEFINITIONS (v2)
// The canonical relevance dimension vocabulary (see docs/RELEVANCE-DIMENSIONS.md).
// Defined on the context type; computed dimension values are stored on nodes.
// ─────────────────────────────────────────────────────────────────────────────

export interface TemporalDimensionConfig {
    /** Whether this type uses a single point or a start–end period */
    anchor: 'point' | 'period';
    /** Frontmatter field holding the start date/datetime */
    startField: string;
    /** For 'period': frontmatter field holding the end date/datetime */
    endField?: string;
    /** For 'period': frontmatter field holding the ISO 8601 duration (e.g. PT2H) */
    durationField?: string;
    /** Days before start when the node becomes relevant. Default: 0. */
    windowBefore: number;
    /** Days after end (or start for point) when relevance ends. Default: 0. */
    windowAfter: number;
    /** Days after relevantEnd before archiving. Absent = never archive. */
    archiveDelay?: number;
}

export interface SemanticDimensionConfig {
    // Vector indexing is automatic — no config needed
}

export interface ContextProximityDimensionConfig {
    /** Max BFS hops from the current query anchors. Default: 2. */
    maxHops?: number;
    /** Edge labels to follow. Absent = all edges. */
    followEdgeLabels?: string[];
}

export interface SocialProximityDimensionConfig {
    /**
     * Frontmatter field holding the relationship type (e.g. 'family', 'colleague').
     * Optional — me-anchored graph distance applies to any entity; the relationship
     * field only refines scoring for entities that carry one (typically people).
     */
    field?: string;
    /**
     * Weight map from relationship type to score [0, 1].
     * Default: { family: 1.0, friend: 0.75, colleague: 0.5, professional: 0.4, acquaintance: 0.25 }
     */
    weights?: Record<string, number>;
}

export interface GoalAlignmentDimensionConfig {
    /** Max hops to search for a connected active goal. Default: 3. */
    maxHops?: number;
}

export interface BehavioralDimensionConfig {
    // Interaction-frequency scoring is automatic — no config needed
}

export interface SpatialDimensionConfig {
    /** Frontmatter field holding { lat: number; lng: number }. Default: 'coordinates'. */
    coordinatesField: string;
    /** Distance (km) at which spatial score reaches 0. Default: 50. */
    maxKm?: number;
}

export interface RecencyDimensionConfig {
    /** Half-life in days for exponential recency decay. Default: 30. */
    halfLifeDays?: number;
}

/**
 * The canonical relevance dimension vocabulary (see docs/RELEVANCE-DIMENSIONS.md).
 * A context type opts into a subset; it does not invent new dimensions.
 *
 * The two graph dimensions differ by anchor point:
 *   - socialProximity — BFS from the "me" node (closeness to the user; stable)
 *   - contextProximity — BFS from the current query anchors (relevance to now)
 */
export type RelevanceDimensionDef =
    | { type: 'temporal';         weight?: number; config: TemporalDimensionConfig }
    | { type: 'semantic';         weight?: number; config?: SemanticDimensionConfig }
    | { type: 'spatial';          weight?: number; config: SpatialDimensionConfig }
    | { type: 'socialProximity';  weight?: number; config?: SocialProximityDimensionConfig }
    | { type: 'goalAlignment';    weight?: number; config?: GoalAlignmentDimensionConfig }
    | { type: 'behavioral';       weight?: number; config?: BehavioralDimensionConfig }
    | { type: 'recency';          weight?: number; config?: RecencyDimensionConfig }
    | { type: 'contextProximity'; weight?: number; config?: ContextProximityDimensionConfig };


export interface EntityTypeConfig {
    name: string;
    plural: string;
    directory: string;          // subdirectory name within the project
    description?: string;
    fields: FieldDef[];
    completionField?: string;   // e.g. 'status'
    completionValue?: string;   // e.g. 'done'
    spawner?: SpawnerConfig;    // present only on entities that spawn children
    calendarDateField?: string; // field key used for calendar start (date or datetime)
    calendarEndField?: string;  // field key for period end (date or datetime)
    calendarDurationField?: string; // field key for period duration (duration)
    /** Temporal window configuration — drives relevance filtering and auto-archive */
    temporal?: TemporalConfig;
    /** Relevance dimension definitions — the canonical relevance vocabulary (see docs/RELEVANCE-DIMENSIONS.md) */
    dimensions?: RelevanceDimensionDef[];
    /**
     * Generic grouping tag — the root category this type rolls up to. CxMS stores
     * it opaquely; the domain layer (Phaibel) defines and interprets the values
     * (see entities/base-categories.ts).
     */
    baseCategory?: string;
    /** A more-general type this one specializes (e.g. immediate-family → person). Adds specificity. */
    parent?: string;
    /** @deprecated Use temporal.windowDaysBefore instead */
    timeWindowDaysPast?: number;
    /** @deprecated Use temporal.windowDaysAfter instead */
    timeWindowDaysFuture?: number;
    /**
     * Optional Phaibel-block view templates rendered by the clients (deterministic
     * interpolation). CxMS stores them as opaque data — it does not render. Each
     * is a block array with {{placeholders}}; absent → clients use smart defaults.
     */
    views?: { summary?: unknown[]; detail?: unknown[] };
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERIC RELEVANCE INHERITANCE  (CxMS mechanism — domain-agnostic)
// These walk the subtype (parent) chain. CxMS knows nothing about which
// categories exist; the DOMAIN layer (Phaibel) defines the concrete base
// categories and their default profiles — see entities/base-categories.ts.
// ─────────────────────────────────────────────────────────────────────────────

/** Per-query specificity bonus: final score is multiplied by (1 + β·specificity). */
export const SPECIFICITY_BONUS = 0.2;

/**
 * Resolve a type's relevance dimensions by walking the subtype chain: its own,
 * else its parent's (recursively). Returns [] when neither defines any — the
 * domain layer decides any base-category fallback (see resolveDomainDimensions).
 */
export function resolveDimensions(
    cfg: EntityTypeConfig | undefined,
    byName: Map<string, EntityTypeConfig>,
    seen: Set<string> = new Set(),
): RelevanceDimensionDef[] {
    if (!cfg || seen.has(cfg.name)) return [];
    if (cfg.dimensions && cfg.dimensions.length > 0) return cfg.dimensions;
    seen.add(cfg.name);
    if (cfg.parent) return resolveDimensions(byName.get(cfg.parent), byName, seen);
    return [];
}

/**
 * Specificity = number of parent links to the base/generic type (0 for a
 * generic base type, 1 for a direct subtype, etc.). Drives the specificity bonus.
 */
export function getSpecificity(
    cfg: EntityTypeConfig | undefined,
    byName: Map<string, EntityTypeConfig>,
    seen: Set<string> = new Set(),
): number {
    if (!cfg || !cfg.parent || seen.has(cfg.name)) return 0;
    seen.add(cfg.name);
    return 1 + getSpecificity(byName.get(cfg.parent), byName, seen);
}

/**
 * A type plus every type that specializes it (any depth). Retrieval scoped to
 * "place" must see spots and residences too — a subject typed at the base
 * level would otherwise silently miss every entity stored under a subtype.
 */
export function getTypeWithDescendants(
    root: string,
    byName: Map<string, EntityTypeConfig>,
): string[] {
    const out = [root];
    for (const cfg of byName.values()) {
        if (cfg.name === root) continue;
        let cur: EntityTypeConfig | undefined = cfg;
        const seen = new Set<string>();
        while (cur?.parent && !seen.has(cur.name)) {
            seen.add(cur.name);
            if (cur.parent === root) { out.push(cfg.name); break; }
            cur = byName.get(cur.parent);
        }
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// CACHE
// ─────────────────────────────────────────────────────────────────────────────

let _cache: EntityTypeConfig[] | null = null;

export function invalidateCache(): void {
    _cache = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOAD / SAVE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load entity type configs. Returns vault file contents if present,
 * otherwise falls back to built-in defaults.
 */
export async function loadEntityTypes(): Promise<EntityTypeConfig[]> {
    if (_cache) return _cache;

    // Built-in types come from code (always current — no per-vault copy to keep
    // in sync). User-created types live directory-native in the CxMS foundation
    // at (Foundation)/context-types/{name}/.cxms.md. There is no central registry.
    const types: EntityTypeConfig[] = DEFAULT_ENTITY_TYPES.map(d => ({ ...d }));
    try {
        const { loadContextTypesFromStore } = await import('../cxms/context-type-store.js');
        const stored = await loadContextTypesFromStore();
        if (stored) {
            const byName = new Map(types.map(t => [t.name, t]));
            for (const s of stored) {
                const existing = byName.get(s.name);
                if (existing) {
                    // A stored override of a built-in: merge it in, but keep the
                    // built-in's node directory (built-ins live at top-level dirs).
                    Object.assign(existing, s, { directory: existing.directory });
                } else {
                    types.push(s);
                    byName.set(s.name, s);
                }
            }
        }
    } catch (err) {
        debug('entity-types', `Context-type store unavailable, using built-in defaults only: ${err}`);
    }
    _cache = types;
    return _cache;
}

/**
 * Ensure the foundation's type directories exist. Built-in types come from code,
 * so there is no registry to seed — this just makes the on-disk homes:
 * context-types/ for user-created types, plus each built-in's node directory.
 */
export async function initEntityTypes(): Promise<void> {
    try {
        const { storage, paths } = getPlatform();
        const root = await getVaultRoot();
        await storage.mkdir(paths.join(root, 'context-types'), { recursive: true });
        for (const t of DEFAULT_ENTITY_TYPES) {
            await storage.mkdir(paths.join(root, t.directory), { recursive: true });
        }
    } catch (err) {
        debug('entity-types', `initEntityTypes directory setup skipped: ${err}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCESSORS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the config for a specific entity type by name.
 */
export async function getEntityType(name: string): Promise<EntityTypeConfig | null> {
    const types = await loadEntityTypes();
    return types.find(t => t.name === name) ?? null;
}

/**
 * List all registered entity type names.
 */
export async function listEntityTypeNames(): Promise<string[]> {
    const types = await loadEntityTypes();
    return types.map(t => t.name);
}

/**
 * Get all entity types that have a spawner config.
 */
export async function getSpawnerTypes(): Promise<EntityTypeConfig[]> {
    const types = await loadEntityTypes();
    return types.filter(t => t.spawner !== undefined);
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Add a new entity type. Throws if name already exists.
 * Creates the entity directory and a .cxms.md context file.
 */
export async function addEntityType(config: EntityTypeConfig): Promise<void> {
    const types = await loadEntityTypes();
    if (types.find(t => t.name === config.name)) {
        throw new Error(`Entity type "${config.name}" already exists.`);
    }
    if (config.calendarDateField) {
        const field = config.fields.find(f => f.key === config.calendarDateField);
        if (!field) {
            throw new Error(`calendarDateField "${config.calendarDateField}" does not match any field in this entity type.`);
        }
        const calendarTypes: FieldType[] = ['date', 'datetime', 'date-fixed', 'date-floating'];
        if (!calendarTypes.includes(field.type)) {
            throw new Error(`calendarDateField "${config.calendarDateField}" must be a date, datetime, date-fixed, or date-floating field, got "${field.type}".`);
        }
    }
    // User-created types are directory-native: the type's directory holds both its
    // .cxms.md (full lossless config) and its nodes.
    if (!config.directory) config.directory = `context-types/${config.name}`;
    const { writeContextType } = await import('../cxms/context-type-store.js');
    await writeContextType(config);
    invalidateCache();
}

/**
 * Replace an entity type by name. Throws if not found.
 */
export async function updateEntityType(name: string, config: EntityTypeConfig): Promise<void> {
    const types = await loadEntityTypes();
    if (!types.find(t => t.name === name)) throw new Error(`Entity type "${name}" not found.`);
    const { writeContextType } = await import('../cxms/context-type-store.js');
    await writeContextType({ ...config, name });
    invalidateCache();
}

/**
 * Remove an entity type by name. Throws if not found or is built-in.
 */
export async function removeEntityType(name: string): Promise<void> {
    if (BUILT_IN_TYPE_NAMES.has(name)) {
        throw new Error(`"${name}" is a built-in type and cannot be removed.`);
    }
    const types = await loadEntityTypes();
    if (!types.find(t => t.name === name)) throw new Error(`Entity type "${name}" not found.`);
    const { removeContextTypeDir } = await import('../cxms/context-type-store.js');
    await removeContextTypeDir(name);
    invalidateCache();
}

export { BUILT_IN_TYPE_NAMES };

// ── v5 Aliases ───────────────────────────────────────────────────────────────

/** @deprecated Use ContextTypeConfig */
export type ContextTypeConfig = EntityTypeConfig;

/** @deprecated Use loadContextTypes() */
export const loadContextTypes = loadEntityTypes;

/** @deprecated Use getContextType() */
export const getContextType = getEntityType;

/** @deprecated Use listContextTypeNames() */
export const listContextTypeNames = listEntityTypeNames;
