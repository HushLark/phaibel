import { getPlatform } from '../platform/index.js';
import { StateSchema, type State } from '../schemas/index.js';
import { getResponse } from '../responses.js';
import { getPersonality } from '../personalities.js';
import { debug } from '../utils/debug.js';
import { autoMigrateV4ToV5 } from '../cxms/auto-migrate.js';
import { setFoundationRoot as setCxmsFoundationRoot } from '@gclift/cxms';
import chalk from 'chalk';

const CXMS_FILE = '.cxms.md';
const FOUNDATION_FILE = '.phaibel.md'; // v4.5 legacy
const VAULT_FILE = '.vault.md'; // v4 legacy
const STATE_FILE = '.state.json';

let cachedFoundationRoot: string | null = null;

/** Internal helper: cache the root and sync it to @gclift/cxms */
function cacheRoot(root: string): void {
    cachedFoundationRoot = root;
    setCxmsFoundationRoot(root);
}

/**
 * Reset the foundation root cache.  Used by integration tests that create
 * temporary foundations so that `findFoundationRoot` re-scans the directory tree.
 */
export function resetFoundationCache(): void {
    cachedFoundationRoot = null;
}

/**
 * Explicitly set the foundation root path.
 * Used by the Expo app where there's no cwd-based discovery.
 */
export function setFoundationRoot(path: string): void {
    cacheRoot(path);
}

/** @deprecated Use resetFoundationCache() */
export const resetVaultCache = resetFoundationCache;

/**
 * Finds the Foundation root by looking for .phaibel.md (v5) or .vault.md (v4 fallback)
 * in cwd or parent directories. Also checks the PHAIBEL_VAULT env var.
 * Returns null if no foundation is found.
 */
export async function findFoundationRoot(): Promise<string | null> {
    if (cachedFoundationRoot) {
        return cachedFoundationRoot;
    }

    const { storage, paths } = getPlatform();
    const platform = getPlatform();

    const envVault = process.env.PHAIBEL_VAULT;
    if (envVault) {
        // Try .cxms.md (v5) first
        try {
            await storage.access(paths.join(envVault, CXMS_FILE));
            cacheRoot(envVault);
            return envVault;
        } catch {
            // Try .phaibel.md (v4.5) or .vault.md (v4) — auto-migrate if found
            for (const legacyFile of [FOUNDATION_FILE, VAULT_FILE]) {
                try {
                    await storage.access(paths.join(envVault, legacyFile));
                    await autoMigrateV4ToV5(envVault);
                    cacheRoot(envVault);
                    return envVault;
                } catch { /* try next */ }
            }
        }
    }

    const systemDir = platform.systemDir();
    let currentDir = process.cwd();

    while (currentDir !== paths.dirname(currentDir)) {
        // Never treat the system directory as a foundation
        if (currentDir === systemDir) {
            currentDir = paths.dirname(currentDir);
            continue;
        }
        // Try .cxms.md (v5) first
        try {
            await storage.access(paths.join(currentDir, CXMS_FILE));
            cacheRoot(currentDir);
            return currentDir;
        } catch {
            // Try legacy markers — auto-migrate if found
            for (const legacyFile of [FOUNDATION_FILE, VAULT_FILE]) {
                try {
                    await storage.access(paths.join(currentDir, legacyFile));
                    await autoMigrateV4ToV5(currentDir);
                    cacheRoot(currentDir);
                    return currentDir;
                } catch { /* try next */ }
            }
        }
        currentDir = paths.dirname(currentDir);
    }

    return null;
}

/** @deprecated Use findFoundationRoot() */
export const findVaultRoot = findFoundationRoot;

/**
 * Gets the Foundation root, throwing an error if not in a foundation.
 */
export async function getFoundationRoot(): Promise<string> {
    const root = await findFoundationRoot();

    if (!root) {
        const agentName = await getAgentName();
        console.error(chalk.red(`\n🤖 ${agentName} cannot find a foundation here.`));
        console.error(chalk.gray('No .phaibel.md found in this directory or any parent.'));
        console.error(chalk.gray('\nTo create a foundation, run: phaibel init'));
        throw new Error('No foundation found in current directory tree');
    }

    return root;
}

/** @deprecated Use getFoundationRoot() */
export const getVaultRoot = getFoundationRoot;

/**
 * Checks if the current directory is inside a valid foundation.
 */
export async function isInFoundation(): Promise<boolean> {
    return (await findFoundationRoot()) !== null;
}

/** @deprecated Use isInFoundation() */
export const isInVault = isInFoundation;

function getStatePath(vaultRoot: string): string {
    return getPlatform().paths.join(vaultRoot, STATE_FILE);
}

const DEFAULT_STATE: State = {
    lastUsed: undefined,
};

export async function loadState(): Promise<State> {
    try {
        const vaultRoot = await getVaultRoot();
        const data = await getPlatform().storage.readFile(getStatePath(vaultRoot));
        return StateSchema.parse(JSON.parse(data));
    } catch {
        return DEFAULT_STATE;
    }
}

export async function saveState(state: State): Promise<void> {
    const vaultRoot = await getVaultRoot();
    state.lastUsed = new Date().toISOString().split('T')[0];
    await getPlatform().storage.writeFile(getStatePath(vaultRoot), JSON.stringify(state, null, 2));
}

/**
 * Gets the user's name from state, falling back to OS username.
 */
export async function getUserName(): Promise<string> {
    const state = await loadState();
    return state.userName || 'friend';
}

/**
 * Sets the user's name in state.
 */
export async function setUserName(name: string): Promise<void> {
    const state = await loadState();
    state.userName = name;
    await saveState(state);
}

/**
 * Gets the agent name from state, falling back to 'Agent'.
 */
export async function getAgentName(): Promise<string> {
    try {
        const state = await loadState();
        return state.agentName || 'Agent';
    } catch {
        return 'Agent';
    }
}

/**
 * Gets the personality ID from state, falling back to 'butler'.
 */
export async function getPersonalityId(): Promise<string> {
    try {
        const state = await loadState();
        return state.personality || 'butler';
    } catch {
        return 'butler';
    }
}

/**
 * Gets a random honorific from the user's gender pool, based on personality.
 * For 'executive' personality (empty honorific pool), returns the user's name.
 */
export async function getUserHonorific(): Promise<string> {
    const state = await loadState();
    const gender = state.gender || 'other';
    const personalityId = state.personality || 'butler';
    const personality = getPersonality(personalityId);
    const pool = personality.honorifics[gender] || personality.honorifics.other || [];

    // Executive personality has no honorifics — use name
    if (pool.length === 0) {
        return state.userName || 'friend';
    }

    return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Gets the user's gender from state.
 */
export async function getUserGender(): Promise<string | undefined> {
    const state = await loadState();
    return state.gender;
}

/**
 * Sets the user's gender in state.
 */
export async function setUserGender(gender: 'male' | 'female' | 'other'): Promise<void> {
    const state = await loadState();
    state.gender = gender;
    await saveState(state);
}

/**
 * Whether the onboarding interview has been completed.
 */
export async function isInterviewComplete(): Promise<boolean> {
    const state = await loadState();
    return state.interviewComplete === true;
}

/**
 * Save the full user profile from the onboarding interview.
 */
export async function saveProfile(profile: {
    userName: string;
    agentName?: string;
    personality?: 'butler' | 'rockstar' | 'executive' | 'friend' | 'pip' | 'emm';
    honorific?: string;
    gender?: 'male' | 'female' | 'other';
    workType?: string;
    familySituation?: string;
    hasCar?: boolean;
    cityLive?: string;
    cityWork?: string;
    personalCalUrl?: string;
    workCalUrl?: string;
}): Promise<void> {
    const state = await loadState();
    state.userName = profile.userName;
    if (profile.agentName) state.agentName = profile.agentName;
    if (profile.personality) state.personality = profile.personality;
    if (profile.honorific) state.honorific = profile.honorific;
    if (profile.gender) state.gender = profile.gender;
    state.workType = profile.workType;
    state.familySituation = profile.familySituation;
    state.hasCar = profile.hasCar;
    state.cityLive = profile.cityLive;
    state.cityWork = profile.cityWork;
    state.personalCalUrl = profile.personalCalUrl;
    state.workCalUrl = profile.workCalUrl;
    state.interviewComplete = true;
    await saveState(state);
    await ensureSelfPerson(state.userName, state.gender);
}

/**
 * Ensure a "me" person node exists for the vault owner — the anchor for
 * user-centric relevance (social / context proximity; see
 * docs/RELEVANCE-DIMENSIONS.md). Without it `getMeNode()` returns null and the
 * me-anchored social-proximity signal can't fire.
 *
 * Idempotent: created on first profile save (onboarding), name kept in sync on
 * later edits. Best-effort — never throws into the onboarding/profile flow.
 * Uses a dynamic import because entities → state/manager is a static dependency.
 */
export async function ensureSelfPerson(userName: string | undefined, gender?: string): Promise<void> {
    const name = userName?.trim();
    if (!name) return;
    try {
        const { listEntities, createEntityMeta, ensureEntityDir, writeEntity, nodeFilename } =
            await import('../entities/entity.js');
        const { join } = await import('path');

        const people = await listEntities('person').catch(() => []);
        const existing = people.find(p => p.meta.isMe === true);
        if (existing) {
            const current = String(existing.meta.name ?? existing.meta.title ?? '');
            if (current !== name) {
                existing.meta.name = name;
                if (gender) existing.meta.gender = gender;
                await writeEntity(existing.filepath, existing.meta, existing.content);
            }
            return;
        }

        const meta: Record<string, unknown> = { ...createEntityMeta('person', name, { tags: ['me'] }) };
        meta.isMe = true;
        if (gender) meta.gender = gender;
        const dir = await ensureEntityDir('person');
        const filepath = join(dir, nodeFilename(name, meta.id as string));
        await writeEntity(filepath, meta, '');
        debug('state', `Created self person node: ${name}`);
    } catch (err) {
        debug('state', `ensureSelfPerson failed: ${err}`);
    }
}
