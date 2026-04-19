/**
 * Phaibel Evaluation Harness — Vault Setup
 *
 * Creates temporary vaults with pre-seeded entities for eval scenarios.
 */
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { resetVaultCache } from '../src/state/manager.js';
import { invalidateCache as invalidateEntityTypeCache, loadEntityTypes } from '../src/entities/entity-type-config.js';
import { createEntityMeta, writeEntity, listEntities, entityFilename } from '../src/entities/entity.js';
import { resetEntityIndex } from '../src/entities/entity-index.js';
import { resetEmbeddingIndex } from '../src/entities/embedding-index.js';
import { DEFAULT_ENTITY_TYPES } from '../src/entities/entity-types-defaults.js';
import type { VaultSeedEntity, VaultSnapshot, SnapshotEntity } from './types.js';

let vaultDir: string | null = null;
let originalCwd: string;

// Entity types to include by default in eval vaults (superset for full testing)
const EVAL_ENTITY_TYPES = [
    ...DEFAULT_ENTITY_TYPES,
    {
        name: 'goal',
        plural: 'goals',
        directory: 'goals',
        description: 'Long-term objectives to work toward',
        defaultTags: ['goal'],
        fields: [
            { key: 'status', type: 'enum', label: 'Status', values: ['active', 'achieved', 'abandoned'], default: 'active', required: true },
            { key: 'priority', type: 'enum', label: 'Priority', values: ['low', 'medium', 'high'], default: 'medium', required: true },
            { key: 'targetDate', type: 'date', label: 'Target Date', required: false },
        ],
        completionField: 'status',
        completionValue: 'achieved',
    },
    {
        name: 'person',
        plural: 'people',
        directory: 'people',
        description: 'Contacts and people you interact with',
        defaultTags: ['person'],
        fields: [
            { key: 'email', type: 'string', label: 'Email', required: false },
            { key: 'phone', type: 'string', label: 'Phone', required: false },
            { key: 'company', type: 'string', label: 'Company', required: false },
            { key: 'role', type: 'string', label: 'Role', required: false },
        ],
    },
    {
        name: 'recurrence',
        plural: 'recurrences',
        directory: 'recurrences',
        description: 'Recurring tasks or habits',
        defaultTags: ['recurrence'],
        fields: [
            { key: 'cadence', type: 'enum', label: 'Cadence', values: ['daily', 'weekly', 'monthly'], default: 'weekly', required: true },
        ],
    },
];

/**
 * Create a temporary vault with `.vault.md`, `.state.json`, entity-types.json,
 * and entity directories. Optionally seed entities.
 */
export async function createEvalVault(
    seed?: VaultSeedEntity[],
    vaultContext?: string,
): Promise<string> {
    originalCwd = process.cwd();
    vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'phaibel-eval-'));

    // v5 Foundation marker (prevents v4→v5 migration from running)
    const foundationMd = vaultContext ?? '---\ntitle: Eval Foundation\n---\nThis is an evaluation foundation for testing Phaibel.';
    await fs.writeFile(path.join(vaultDir, '.phaibel.md'), foundationMd);

    // v5 migration marker — signals already migrated
    await fs.writeFile(path.join(vaultDir, '.v5-migrated'), JSON.stringify({
        migratedAt: new Date().toISOString(),
        fromVersion: 5,
        toVersion: 5,
        idsRemapped: 0,
    }));

    // State (test personality)
    await fs.writeFile(path.join(vaultDir, '.state.json'), JSON.stringify({
        activeProject: null,
        userName: 'Tester',
        agentName: 'Phaibel',
        personalityId: 'butler',
        gender: 'neutral',
    }));

    // .phaibel config dir
    const configDir = path.join(vaultDir, '.phaibel');
    await fs.mkdir(configDir, { recursive: true });
    await fs.mkdir(path.join(configDir, 'logs'), { recursive: true });

    // Entity types config
    await fs.writeFile(
        path.join(configDir, 'entity-types.json'),
        JSON.stringify({ version: 1, entityTypes: EVAL_ENTITY_TYPES }, null, 2),
    );

    // Create entity directories
    for (const et of EVAL_ENTITY_TYPES) {
        await fs.mkdir(path.join(vaultDir, et.directory), { recursive: true });
    }

    // Reset all caches/singletons so the new vault is discovered cleanly
    process.chdir(vaultDir);
    resetVaultCache();
    invalidateEntityTypeCache();
    resetEntityIndex();
    resetEmbeddingIndex();

    // Seed entities
    if (seed && seed.length > 0) {
        for (const s of seed) {
            const meta = createEntityMeta(s.entityType, s.title);
            if (s.fields) {
                Object.assign(meta, s.fields);
            }
            const dir = path.join(vaultDir, getEntityDir(s.entityType));
            const filepath = path.join(dir, entityFilename(s.title, meta.id as string));
            await writeEntity(filepath, meta as unknown as Record<string, unknown>, s.body ?? '');
        }
    }

    return vaultDir;
}

/** Map entity type name to directory name. */
function getEntityDir(entityType: string): string {
    const et = EVAL_ENTITY_TYPES.find(t => t.name === entityType);
    return et?.directory ?? entityType;
}

/**
 * Destroy the temporary vault and restore the original cwd.
 */
export async function destroyEvalVault(): Promise<void> {
    if (originalCwd) {
        process.chdir(originalCwd);
    }
    resetVaultCache();
    invalidateEntityTypeCache();
    resetEntityIndex();
    resetEmbeddingIndex();
    if (vaultDir) {
        await fs.rm(vaultDir, { recursive: true, force: true });
        vaultDir = null;
    }
}

/**
 * Snapshot the vault: read all entities from all entity type directories.
 * Returns a map of entityType → array of {title, meta, body}.
 */
export async function snapshotVault(): Promise<VaultSnapshot> {
    const snapshot: VaultSnapshot = {};

    // Load all entity types (including dynamically-created ones)
    const allTypes = await loadEntityTypes();
    const typeNames = new Set([
        ...EVAL_ENTITY_TYPES.map(et => et.name),
        ...allTypes.map(et => et.name),
    ]);

    for (const typeName of typeNames) {
        try {
            const entities = await listEntities(typeName);
            snapshot[typeName] = entities.map(e => ({
                title: String(e.meta.title ?? ''),
                meta: JSON.parse(JSON.stringify(e.meta)),
                body: e.content,
            }));
        } catch {
            snapshot[typeName] = [];
        }
    }
    return snapshot;
}
