// ─────────────────────────────────────────────────────────────────────────────
// ENTITY TYPE CONFIG
// Loads entity type definitions from {vault}/.phaibel/entity-types.json.
// Falls back to built-in defaults if the file doesn't exist.
// Users can add, modify, or extend entity types by editing the JSON file.
// ─────────────────────────────────────────────────────────────────────────────

import { getPlatform } from '../platform/index.js';
import { DEFAULT_ENTITY_TYPES, BUILT_IN_TYPE_NAMES } from './entity-types-defaults.js';
import { debug } from '../utils/debug.js';
import { getEntityTypesPath, getVaultConfigDir } from '../paths.js';
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


/**
 * The six base categories — the top-level ontology of a person's life.
 * Every context type rolls up to exactly one. Each carries a default relevance
 * profile (BASE_CATEGORY_DIMENSIONS); specific subtypes inherit and sharpen it.
 * (See docs/RELEVANCE-DIMENSIONS.md.)
 *   person — people
 *   place  — locations
 *   thing  — objects, notes, documents, records
 *   event  — period-anchored happenings you attend (duration)
 *   task   — point-anchored actions you complete (a checkbox with a deadline)
 *   goal   — what you're working toward (the "why"; hub for alignment)
 */
export type BaseCategory = 'person' | 'place' | 'thing' | 'event' | 'task' | 'goal';

export interface EntityTypeConfig {
    name: string;
    plural: string;
    directory: string;          // subdirectory name within the project
    description?: string;
    defaultTags?: string[];
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
    /** Which base category this type rolls up to. Drives inherited relevance + specificity. */
    baseCategory?: BaseCategory;
    /** A more-general type this one specializes (e.g. immediate-family → person). Adds specificity. */
    parent?: string;
    /** @deprecated Use temporal.windowDaysBefore instead */
    timeWindowDaysPast?: number;
    /** @deprecated Use temporal.windowDaysAfter instead */
    timeWindowDaysFuture?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// BASE CATEGORY RELEVANCE PROFILES
// Default dimension weights per base category (docs/RELEVANCE-DIMENSIONS.md §3).
// A type with no own `dimensions` inherits its parent's, falling back to these.
// ─────────────────────────────────────────────────────────────────────────────

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

/** Per-query specificity bonus: final score is multiplied by (1 + β·specificity). */
export const SPECIFICITY_BONUS = 0.2;

/**
 * Resolve a type's effective relevance dimensions: its own, else its parent's
 * (recursively), else its base category's default profile, else none.
 */
export function resolveDimensions(
    cfg: EntityTypeConfig | undefined,
    byName: Map<string, EntityTypeConfig>,
    seen: Set<string> = new Set(),
): RelevanceDimensionDef[] {
    if (!cfg || seen.has(cfg.name)) return [];
    if (cfg.dimensions && cfg.dimensions.length > 0) return cfg.dimensions;
    seen.add(cfg.name);
    if (cfg.parent) {
        const inherited = resolveDimensions(byName.get(cfg.parent), byName, seen);
        if (inherited.length > 0) return inherited;
    }
    if (cfg.baseCategory) return BASE_CATEGORY_DIMENSIONS[cfg.baseCategory] ?? [];
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

interface EntityTypesFile {
    version: number;
    entityTypes: EntityTypeConfig[];
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

    try {
        const { storage } = getPlatform();
        const typesPath = await getEntityTypesPath();
        const raw = await storage.readFile(typesPath, 'utf-8');
        const parsed: EntityTypesFile = JSON.parse(raw);
        if (!Array.isArray(parsed.entityTypes)) {
            throw new Error('entity-types.json missing entityTypes array');
        }
        // Merge new built-in properties into saved configs for built-in types
        // so that new features (e.g. calendarDateField) propagate to existing vaults
        const defaultsByName = new Map(DEFAULT_ENTITY_TYPES.map(d => [d.name, d]));
        let dirty = false;
        for (const saved of parsed.entityTypes) {
            const builtin = defaultsByName.get(saved.name);
            if (!builtin) continue;
            if (saved.calendarDateField === undefined && builtin.calendarDateField) {
                saved.calendarDateField = builtin.calendarDateField;
                dirty = true;
            }
            if (saved.calendarEndField === undefined && builtin.calendarEndField) {
                saved.calendarEndField = builtin.calendarEndField;
                dirty = true;
            }
            if (saved.calendarDurationField === undefined && builtin.calendarDurationField) {
                saved.calendarDurationField = builtin.calendarDurationField;
                dirty = true;
            }
            if (saved.completionField === undefined && builtin.completionField) {
                saved.completionField = builtin.completionField;
                saved.completionValue = builtin.completionValue;
                dirty = true;
            }
            if (saved.spawner === undefined && builtin.spawner) {
                saved.spawner = builtin.spawner;
                dirty = true;
            }
            if (saved.temporal === undefined && builtin.temporal) {
                saved.temporal = builtin.temporal;
                dirty = true;
            }
            // Sync field types from defaults (e.g. date → datetime migration)
            const builtinFields = new Map(builtin.fields.map(f => [f.key, f]));
            for (const savedField of saved.fields) {
                const builtinField = builtinFields.get(savedField.key);
                if (builtinField && savedField.type !== builtinField.type) {
                    savedField.type = builtinField.type;
                    dirty = true;
                }
                if (builtinField && savedField.label !== builtinField.label) {
                    savedField.label = builtinField.label;
                    dirty = true;
                }
                if (builtinField && savedField.required !== builtinField.required) {
                    savedField.required = builtinField.required;
                    dirty = true;
                }
            }
        }
        // Persist merged changes so they stick across restarts
        if (dirty) {
            await saveEntityTypes(parsed.entityTypes);
        }
        _cache = parsed.entityTypes;
        return _cache;
    } catch (err) {
        debug('entity-types', `Using built-in defaults: ${err}`);
        _cache = DEFAULT_ENTITY_TYPES;
        return _cache;
    }
}

/**
 * Save entity type configs to the vault file.
 */
export async function saveEntityTypes(types: EntityTypeConfig[]): Promise<void> {
    const { storage } = getPlatform();
    const dir = await getVaultConfigDir();
    await storage.mkdir(dir, { recursive: true });
    const typesPath = await getEntityTypesPath();
    const file: EntityTypesFile = { version: 1, entityTypes: types };
    await storage.writeFile(typesPath, JSON.stringify(file, null, 2));
    invalidateCache();
}

/**
 * Write entity-types.json with built-in defaults if it doesn't already exist.
 * Called by `phaibel init`.
 */
export async function initEntityTypes(): Promise<void> {
    try {
        const typesPath = await getEntityTypesPath();
        await getPlatform().storage.access(typesPath);
        debug('entity-types', 'entity-types.json already exists — skipping init');
    } catch {
        await saveEntityTypes(DEFAULT_ENTITY_TYPES);
        const typesPath = await getEntityTypesPath();
        debug('entity-types', `Created ${typesPath}`);
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
    types.push(config);
    await saveEntityTypes(types);

    // Create entity directory + .cxms.md context file
    try {
        const { storage, paths } = getPlatform();
        const vaultRoot = await getVaultRoot();
        const entityDir = paths.join(vaultRoot, config.directory);
        await storage.mkdir(entityDir, { recursive: true });

        const vaultMdPath = paths.join(entityDir, '.cxms.md');
        const fieldLines = config.fields.map(f => {
            let desc = `- **${f.key}** (${f.type})`;
            if (f.label) desc += ` — ${f.label}`;
            if (f.type === 'enum' && f.values) desc += `: ${f.values.join(', ')}`;
            if (f.default !== undefined) desc += ` [default: ${f.default}]`;
            return desc;
        });

        const completionNote = config.completionField
            ? `\nCompletion: set \`${config.completionField}\` to \`${config.completionValue ?? 'done'}\` to mark as complete.\n`
            : '';

        const content = `# ${config.plural.charAt(0).toUpperCase() + config.plural.slice(1)}

${config.description || `A collection of ${config.plural}.`}

## Fields

${fieldLines.join('\n')}
${completionNote}
## Guidelines

- Use the exact field names above when creating or updating ${config.plural}.
- Titles should be concise and descriptive.
- When the user refers to "${config.plural}" or "${config.name}", this is the entity type to use.
`;

        await storage.writeFile(vaultMdPath, content);
        debug('entity-types', `Created ${vaultMdPath}`);
    } catch (err) {
        debug('entity-types', `Failed to create .cxms.md for ${config.name}: ${err}`);
        // Non-fatal — type is already registered
    }
}

/**
 * Replace an entity type by name. Throws if not found.
 */
export async function updateEntityType(name: string, config: EntityTypeConfig): Promise<void> {
    const types = await loadEntityTypes();
    const idx = types.findIndex(t => t.name === name);
    if (idx === -1) throw new Error(`Entity type "${name}" not found.`);
    types[idx] = config;
    await saveEntityTypes(types);
}

/**
 * Remove an entity type by name. Throws if not found or is built-in.
 */
export async function removeEntityType(name: string): Promise<void> {
    if (BUILT_IN_TYPE_NAMES.has(name)) {
        throw new Error(`"${name}" is a built-in type and cannot be removed.`);
    }
    const types = await loadEntityTypes();
    const filtered = types.filter(t => t.name !== name);
    if (filtered.length === types.length) throw new Error(`Entity type "${name}" not found.`);
    await saveEntityTypes(filtered);
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
