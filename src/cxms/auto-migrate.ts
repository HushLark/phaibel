// ─────────────────────────────────────────────────────────────────────────────
// CxMS — Auto-Migration (v4 → v5)
// ─────────────────────────────────────────────────────────────────────────────
// Detects a v4 vault (.vault.md) and auto-converts to v5 Foundation
// (.phaibel.md) on first access. Runs once, writes a marker to prevent re-run.
//
// Steps:
//   1. Rename .vault.md → .phaibel.md
//   2. Create v5 directories (profiles/, context-types/, collections/, logs/, feral/)
//   3. Migrate .state.json → profiles/user-profile.md + profiles/phaibel-profile.md
//   4. Migrate entity-types.json → context-types/{type}/.phaibel.md
//   5. Move entity files: todos/ → context-types/task/, notes/ → context-types/note/, etc.
//   6. Move .phaibel/processes/ → feral/processes/
//   7. Regenerate node IDs to 8-char format (update frontmatter + filenames)
//   8. Write migration marker
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { debug } from '../utils/debug.js';
import { generateNodeId, slugify, nodeFilename } from '../entities/entity.js';
import { writeContextType, writeMappingIndex } from './context-type-store.js';
import { saveUserProfile, savePhaibelProfile } from '../profiles/profile-manager.js';
import type { UserProfile, PhaibelProfile } from '../profiles/profile-types.js';
import type { EntityTypeConfig } from '../entities/entity-type-config.js';
import { DEFAULT_ENTITY_TYPES } from '../entities/entity-types-defaults.js';

const MIGRATION_MARKER = '.v5-migrated';

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Check if a v4 vault needs migration and run it if so.
 * Called from findFoundationRoot() when .vault.md is detected.
 * Returns true if migration was performed.
 */
export async function autoMigrateV4ToV5(root: string): Promise<boolean> {
    // Already migrated?
    try {
        await fs.access(path.join(root, MIGRATION_MARKER));
        return false;
    } catch {
        // Not yet migrated — continue
    }

    // Must have .vault.md to be a v4 vault
    try {
        await fs.access(path.join(root, '.vault.md'));
    } catch {
        return false;
    }

    console.log('Migrating v4 vault to v5 Foundation...');
    debug('migrate', `Starting v4→v5 migration at ${root}`);

    try {
        // Step 1: Rename root marker
        await renameRootMarker(root);

        // Step 2: Create v5 directory structure
        await createV5Directories(root);

        // Step 3: Migrate profiles from .state.json
        await migrateProfiles(root);

        // Step 4: Migrate entity types to context-types/
        const types = await migrateEntityTypes(root);

        // Step 5: Move entity files into context-types/{type}/
        const idMap = await migrateEntityFiles(root, types);

        // Step 6: Move Feral processes
        await migrateFeralProcesses(root);

        // Step 7: Update cross-references with new IDs
        if (idMap.size > 0) {
            await updateCrossReferences(root, types, idMap);
        }

        // Step 8: Write migration marker
        const marker = JSON.stringify({
            migratedAt: new Date().toISOString(),
            fromVersion: 4,
            toVersion: 5,
            idsRemapped: idMap.size,
        }, null, 2);
        await fs.writeFile(path.join(root, MIGRATION_MARKER), marker);

        console.log('Migration complete.');
        debug('migrate', `v4→v5 migration complete. ${idMap.size} IDs remapped.`);
        return true;
    } catch (err) {
        console.error('Migration failed:', err);
        debug('migrate', `Migration failed: ${err}`);
        return false;
    }
}

// ── Step 1: Rename root marker ───────────────────────────────────────────────

async function renameRootMarker(root: string): Promise<void> {
    const oldPath = path.join(root, '.vault.md');
    const newPath = path.join(root, '.phaibel.md');

    // Guard against race: if .vault.md is already gone, skip
    try {
        await fs.access(oldPath);
    } catch {
        debug('migrate', '.vault.md already removed (concurrent migration?) — skipping rename');
        return;
    }

    // Read the old vault.md content and update it
    const raw = await fs.readFile(oldPath, 'utf-8');
    const updated = raw
        .replace(/vault/gi, (match) => {
            if (match === 'vault') return 'foundation';
            if (match === 'Vault') return 'Foundation';
            if (match === 'VAULT') return 'FOUNDATION';
            return match;
        });
    await fs.writeFile(newPath, updated);
    try {
        await fs.unlink(oldPath);
    } catch {
        // Another concurrent migration may have already removed it
    }
    debug('migrate', 'Renamed .vault.md → .phaibel.md');
}

// ── Step 2: Create v5 directories ────────────────────────────────────────────

async function createV5Directories(root: string): Promise<void> {
    const dirs = [
        'profiles',
        'context-types',
        'collections',
        'logs',
        'feral',
        'feral/processes',
        'feral/logs',
        'feral/catalog',
    ];
    for (const dir of dirs) {
        await fs.mkdir(path.join(root, dir), { recursive: true });
    }
    debug('migrate', 'Created v5 directory structure');
}

// ── Step 3: Migrate profiles ─────────────────────────────────────────────────

async function migrateProfiles(root: string): Promise<void> {
    const stateFile = path.join(root, '.state.json');
    try {
        const raw = await fs.readFile(stateFile, 'utf-8');
        const state = JSON.parse(raw) as Record<string, unknown>;

        const user: UserProfile = {
            name: (state.userName as string) || 'User',
            gender: state.gender as UserProfile['gender'],
            homeLocation: state.cityLive as string | undefined,
            workLocation: state.cityWork as string | undefined,
            employer: undefined,
            workType: state.workType as string | undefined,
            familySituation: state.familySituation as string | undefined,
            hasCar: state.hasCar as boolean | undefined,
            personalCalUrl: state.personalCalUrl as string | undefined,
            workCalUrl: state.workCalUrl as string | undefined,
            interviewComplete: state.interviewComplete as boolean | undefined,
            lastUsed: state.lastUsed as string | undefined,
        };

        const phaibel: PhaibelProfile = {
            name: (state.agentName as string) || 'Agent',
            personality: (state.personality as PhaibelProfile['personality']) || 'butler',
            honorific: state.honorific as string | undefined,
        };

        await saveUserProfile(user);
        await savePhaibelProfile(phaibel);
        debug('migrate', 'Migrated .state.json → profiles/');
    } catch {
        debug('migrate', 'No .state.json found — skipping profile migration');
    }
}

// ── Step 4: Migrate entity types ─────────────────────────────────────────────

async function migrateEntityTypes(root: string): Promise<EntityTypeConfig[]> {
    let types: EntityTypeConfig[];

    // Try loading from .phaibel/entity-types.json
    const typesFile = path.join(root, '.phaibel', 'entity-types.json');
    try {
        const raw = await fs.readFile(typesFile, 'utf-8');
        const parsed = JSON.parse(raw);
        types = parsed.entityTypes ?? parsed;
    } catch {
        debug('migrate', 'No entity-types.json — using defaults');
        types = [...DEFAULT_ENTITY_TYPES];
    }

    // Update directory paths to v5 format
    for (const t of types) {
        t.directory = `context-types/${t.name}`;
    }

    // Write each type to its context-types/{name}/ directory
    for (const t of types) {
        await writeContextType(t);
    }
    await writeMappingIndex(types);

    debug('migrate', `Migrated ${types.length} entity types to context-types/`);
    return types;
}

// ── Step 5: Move entity files ────────────────────────────────────────────────

/** Map of v4 directory names to v5 context type names */
const DIR_TO_TYPE: Record<string, string> = {
    todos: 'task',
    notes: 'note',
    events: 'event',
    goals: 'goal',
    people: 'person',
    recurrences: 'recurrence',
    research: 'research',
    todonts: 'todont',
};

/**
 * Move entity files from v4 dirs (todos/, notes/) to v5 context-types/{type}/.
 * Regenerates IDs to 8-char format. Returns old→new ID mapping.
 */
async function migrateEntityFiles(
    root: string,
    types: EntityTypeConfig[],
): Promise<Map<string, string>> {
    const idMap = new Map<string, string>(); // old ID → new ID

    // Build lookup of type name → directory from config
    const typeByName = new Map(types.map(t => [t.name, t]));

    // Scan all known v4 directories
    for (const [v4Dir, typeName] of Object.entries(DIR_TO_TYPE)) {
        const srcDir = path.join(root, v4Dir);
        const typeConfig = typeByName.get(typeName);
        if (!typeConfig) continue;

        const destDir = path.join(root, typeConfig.directory);
        await fs.mkdir(destDir, { recursive: true });

        let files: string[];
        try {
            files = await fs.readdir(srcDir);
        } catch {
            continue; // Directory doesn't exist
        }

        for (const file of files) {
            if (!file.endsWith('.md') || file.startsWith('.')) continue;

            const srcPath = path.join(srcDir, file);
            try {
                const raw = await fs.readFile(srcPath, 'utf-8');
                const { data, content } = matter(raw);

                // Generate new 8-char ID
                const oldId = data.id as string;
                const newId = generateNodeId();
                if (oldId) idMap.set(oldId, newId);

                // Update frontmatter
                data.id = newId;
                data.contextType = typeName;
                // Remove old entityType field
                delete data.entityType;
                delete data._filepath;

                // Build new filename
                const title = (data.title as string) || file.replace(/\.md$/, '');
                const newFile = nodeFilename(title, newId);
                const destPath = path.join(destDir, newFile);

                // Write to new location
                const newContent = matter.stringify(content, data);
                await fs.writeFile(destPath, newContent);

                debug('migrate', `Moved ${v4Dir}/${file} → ${typeConfig.directory}/${newFile}`);
            } catch (err) {
                debug('migrate', `Failed to migrate ${srcPath}: ${err}`);
            }
        }

        // Also move any .vault.md context files
        const vaultMd = path.join(srcDir, '.vault.md');
        try {
            await fs.access(vaultMd);
            // The .phaibel.md for this type was already written by writeContextType
            debug('migrate', `Skipping ${v4Dir}/.vault.md — replaced by context-type .phaibel.md`);
        } catch {
            // No .vault.md — that's fine
        }
    }

    // Also scan any custom entity type directories not in DIR_TO_TYPE
    for (const t of types) {
        if (Object.values(DIR_TO_TYPE).includes(t.name)) continue;
        // Custom type — check if old directory exists at root level
        // (Custom types in v4 used their directory name directly)
        const oldDirName = t.name + 's'; // v4 convention was plural as directory
        const srcDir = path.join(root, oldDirName);
        const destDir = path.join(root, t.directory);

        try {
            const files = await fs.readdir(srcDir);
            await fs.mkdir(destDir, { recursive: true });
            for (const file of files) {
                if (!file.endsWith('.md') || file.startsWith('.')) continue;
                const srcPath = path.join(srcDir, file);
                const raw = await fs.readFile(srcPath, 'utf-8');
                const { data, content } = matter(raw);

                const oldId = data.id as string;
                const newId = generateNodeId();
                if (oldId) idMap.set(oldId, newId);

                data.id = newId;
                data.contextType = t.name;
                delete data.entityType;
                delete data._filepath;

                const title = (data.title as string) || file.replace(/\.md$/, '');
                const newFile = nodeFilename(title, newId);
                const destPath = path.join(destDir, newFile);

                const newContent = matter.stringify(content, data);
                await fs.writeFile(destPath, newContent);
            }
        } catch {
            // Directory doesn't exist — skip
        }
    }

    debug('migrate', `Remapped ${idMap.size} entity IDs`);
    return idMap;
}

// ── Step 6: Move Feral processes ─────────────────────────────────────────────

async function migrateFeralProcesses(root: string): Promise<void> {
    const oldDir = path.join(root, '.phaibel', 'processes');
    const newDir = path.join(root, 'feral', 'processes');

    try {
        const files = await fs.readdir(oldDir);
        await fs.mkdir(newDir, { recursive: true });

        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            const src = path.join(oldDir, file);
            const dest = path.join(newDir, file);
            await fs.copyFile(src, dest);
            debug('migrate', `Copied process: ${file}`);
        }
    } catch {
        debug('migrate', 'No .phaibel/processes/ found — skipping');
    }
}

// ── Step 7: Update cross-references ──────────────────────────────────────────

/**
 * Scan all migrated files and update any references to old IDs.
 * Handles: frontmatter links/references, body content mentions.
 */
async function updateCrossReferences(
    root: string,
    types: EntityTypeConfig[],
    idMap: Map<string, string>,
): Promise<void> {
    for (const t of types) {
        const dir = path.join(root, t.directory);
        let files: string[];
        try {
            files = await fs.readdir(dir);
        } catch {
            continue;
        }

        for (const file of files) {
            if (!file.endsWith('.md') || file.startsWith('.')) continue;
            const filepath = path.join(dir, file);
            let raw = await fs.readFile(filepath, 'utf-8');
            let changed = false;

            // Replace old IDs in the file content
            for (const [oldId, newId] of idMap) {
                if (raw.includes(oldId)) {
                    raw = raw.replaceAll(oldId, newId);
                    changed = true;
                }
            }

            if (changed) {
                await fs.writeFile(filepath, raw);
                debug('migrate', `Updated references in ${t.directory}/${file}`);
            }
        }
    }
}
