/**
 * Phaibel Evaluation Harness — Vault Setup
 *
 * Creates temporary vaults with pre-seeded entities for eval scenarios.
 */
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { resetVaultCache } from '../src/state/manager.js';
import { invalidateCache as invalidateEntityTypeCache } from '../src/entities/entity-type-config.js';
import { createEntityMeta, writeEntity, listEntities } from '../src/entities/entity.js';
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

    // Vault marker
    const vaultMd = vaultContext ?? '---\ntitle: Eval Vault\n---\nThis is an evaluation vault for testing Phaibel.';
    await fs.writeFile(path.join(vaultDir, '.vault.md'), vaultMd);

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

    // Reset caches so the new vault is discovered
    process.chdir(vaultDir);
    resetVaultCache();
    invalidateEntityTypeCache();

    // Seed entities
    if (seed && seed.length > 0) {
        for (const s of seed) {
            const meta = createEntityMeta(s.entityType, s.title);
            if (s.fields) {
                Object.assign(meta, s.fields);
            }
            const dir = path.join(vaultDir, getEntityDir(s.entityType));
            const slug = s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            const filepath = path.join(dir, `${slug}.md`);
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
    for (const et of EVAL_ENTITY_TYPES) {
        try {
            const entities = await listEntities(et.name);
            snapshot[et.name] = entities.map(e => ({
                title: String(e.meta.title ?? ''),
                meta: JSON.parse(JSON.stringify(e.meta)),
                body: e.content,
            }));
        } catch {
            snapshot[et.name] = [];
        }
    }
    return snapshot;
}
