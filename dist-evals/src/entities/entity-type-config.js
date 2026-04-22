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
// CACHE
// ─────────────────────────────────────────────────────────────────────────────
let _cache = null;
export function invalidateCache() {
    _cache = null;
}
// ─────────────────────────────────────────────────────────────────────────────
// LOAD / SAVE
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Load entity type configs. Returns vault file contents if present,
 * otherwise falls back to built-in defaults.
 */
export async function loadEntityTypes() {
    if (_cache)
        return _cache;
    try {
        const { storage } = getPlatform();
        const typesPath = await getEntityTypesPath();
        const raw = await storage.readFile(typesPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.entityTypes)) {
            throw new Error('entity-types.json missing entityTypes array');
        }
        // Merge new built-in properties into saved configs for built-in types
        // so that new features (e.g. calendarDateField) propagate to existing vaults
        const defaultsByName = new Map(DEFAULT_ENTITY_TYPES.map(d => [d.name, d]));
        let dirty = false;
        for (const saved of parsed.entityTypes) {
            const builtin = defaultsByName.get(saved.name);
            if (!builtin)
                continue;
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
    }
    catch (err) {
        debug('entity-types', `Using built-in defaults: ${err}`);
        _cache = DEFAULT_ENTITY_TYPES;
        return _cache;
    }
}
/**
 * Save entity type configs to the vault file.
 */
export async function saveEntityTypes(types) {
    const { storage } = getPlatform();
    const dir = await getVaultConfigDir();
    await storage.mkdir(dir, { recursive: true });
    const typesPath = await getEntityTypesPath();
    const file = { version: 1, entityTypes: types };
    await storage.writeFile(typesPath, JSON.stringify(file, null, 2));
    invalidateCache();
}
/**
 * Write entity-types.json with built-in defaults if it doesn't already exist.
 * Called by `phaibel init`.
 */
export async function initEntityTypes() {
    try {
        const typesPath = await getEntityTypesPath();
        await getPlatform().storage.access(typesPath);
        debug('entity-types', 'entity-types.json already exists — skipping init');
    }
    catch {
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
export async function getEntityType(name) {
    const types = await loadEntityTypes();
    return types.find(t => t.name === name) ?? null;
}
/**
 * List all registered entity type names.
 */
export async function listEntityTypeNames() {
    const types = await loadEntityTypes();
    return types.map(t => t.name);
}
/**
 * Get all entity types that have a spawner config.
 */
export async function getSpawnerTypes() {
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
export async function addEntityType(config) {
    const types = await loadEntityTypes();
    if (types.find(t => t.name === config.name)) {
        throw new Error(`Entity type "${config.name}" already exists.`);
    }
    if (config.calendarDateField) {
        const field = config.fields.find(f => f.key === config.calendarDateField);
        if (!field) {
            throw new Error(`calendarDateField "${config.calendarDateField}" does not match any field in this entity type.`);
        }
        const calendarTypes = ['date', 'datetime', 'date-fixed', 'date-floating'];
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
            if (f.label)
                desc += ` — ${f.label}`;
            if (f.type === 'enum' && f.values)
                desc += `: ${f.values.join(', ')}`;
            if (f.default !== undefined)
                desc += ` [default: ${f.default}]`;
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
    }
    catch (err) {
        debug('entity-types', `Failed to create .cxms.md for ${config.name}: ${err}`);
        // Non-fatal — type is already registered
    }
}
/**
 * Replace an entity type by name. Throws if not found.
 */
export async function updateEntityType(name, config) {
    const types = await loadEntityTypes();
    const idx = types.findIndex(t => t.name === name);
    if (idx === -1)
        throw new Error(`Entity type "${name}" not found.`);
    types[idx] = config;
    await saveEntityTypes(types);
}
/**
 * Remove an entity type by name. Throws if not found or is built-in.
 */
export async function removeEntityType(name) {
    if (BUILT_IN_TYPE_NAMES.has(name)) {
        throw new Error(`"${name}" is a built-in type and cannot be removed.`);
    }
    const types = await loadEntityTypes();
    const filtered = types.filter(t => t.name !== name);
    if (filtered.length === types.length)
        throw new Error(`Entity type "${name}" not found.`);
    await saveEntityTypes(filtered);
}
export { BUILT_IN_TYPE_NAMES };
/** @deprecated Use loadContextTypes() */
export const loadContextTypes = loadEntityTypes;
/** @deprecated Use getContextType() */
export const getContextType = getEntityType;
/** @deprecated Use listContextTypeNames() */
export const listContextTypeNames = listEntityTypeNames;
