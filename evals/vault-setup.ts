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

// Bundled skill for skill-scenario testing — daily-briefing
const DAILY_BRIEFING_SKILL_MD = `---
name: daily-briefing
description: Generates a morning briefing summarizing today's tasks, events, and goals
version: "1.0.0"
triggers:
  - morning briefing
  - daily briefing
  - what's on my agenda
  - what do I have today
  - start my day
tags:
  - productivity
  - daily
  - planning
---

# Daily Briefing

Retrieve today's tasks, upcoming events, and active goals, then synthesize a concise morning briefing.
Keep it to 3-5 bullet points and lead with the most important item.
`;

const DAILY_BRIEFING_SCRIPT = JSON.stringify({
    schema_version: 1,
    key: 'skill.daily-briefing',
    description: 'Morning briefing: open tasks, today\'s events, active goals',
    context: {},
    nodes: [
        { key: 'start', catalog_node_key: 'start', configuration: {}, edges: { ok: 'list_tasks' } },
        { key: 'list_tasks', catalog_node_key: 'list_tasks', configuration: { context_path: 'tasks' }, edges: { ok: 'list_events', empty: 'list_events', error: 'list_events' } },
        { key: 'list_events', catalog_node_key: 'list_events', configuration: { context_path: 'events' }, edges: { ok: 'done', empty: 'done', error: 'done' } },
        { key: 'done', catalog_node_key: 'stop', configuration: {}, edges: {} },
    ],
}, null, 2);

let vaultDir: string | null = null;
let originalCwd: string;

// Entity types to include by default in eval vaults (superset for full testing)
const EVAL_ENTITY_TYPES = [
    // Use the production defaults (person, goal, event, task, … now carry
    // baseCategory). Only add eval-specific extras below.
    ...DEFAULT_ENTITY_TYPES,
    {
        name: 'recurrence',
        baseCategory: 'task' as const,
        plural: 'recurrences',
        directory: 'recurrences',
        description: 'Recurring tasks or habits',
        defaultTags: ['recurrence'],
        fields: [
            { key: 'cadence', type: 'enum', label: 'Cadence', values: ['daily', 'weekly', 'monthly'], default: 'weekly', required: true },
        ],
    },
    // Example subtype — a more specific Human. Inherits person's relevance
    // profile and earns a specificity bonus over a generic person.
    {
        name: 'immediate_family',
        baseCategory: 'human' as const,
        parent: 'person',
        plural: 'immediate_family',
        directory: 'immediate-family',
        description: 'Spouse, children, parents — the people closest to you',
        defaultTags: ['family'],
        fields: [
            { key: 'type', type: 'string', label: 'Relationship Type', required: false },
            { key: 'relation', type: 'string', label: 'Relation', required: false },
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

    // Install built-in skills so skill scenarios can activate them
    const skillsDir = path.join(vaultDir, 'skills', 'daily-briefing', 'scripts');
    await fs.mkdir(skillsDir, { recursive: true });
    await fs.writeFile(path.join(skillsDir, '..', 'SKILL.md'), DAILY_BRIEFING_SKILL_MD);
    await fs.writeFile(path.join(skillsDir, 'briefing.json'), DAILY_BRIEFING_SCRIPT);

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
