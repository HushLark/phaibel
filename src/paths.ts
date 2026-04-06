// ─────────────────────────────────────────────────────────────────────────────
// PATHS — Central path resolution for Phaibel
// ─────────────────────────────────────────────────────────────────────────────
//
// Two root directories:
//   ~/.phaibel/                 Secrets + daemon runtime (pid, sock)
//   {foundation}/.phaibel/      Legacy config (v4 compat)
//   {foundation}/               Foundation root — context types, profiles, etc.
//
// v5 stores config at the Foundation root level. The .phaibel/ subdirectory
// is kept for backward compatibility with v4 configs (skills, agents, etc.).
// ─────────────────────────────────────────────────────────────────────────────

import path from 'path';
import os from 'os';
import { findFoundationRoot, findVaultRoot } from './state/manager.js';

/** System-level directory — only secrets and daemon runtime. */
export const SYSTEM_DIR = path.join(os.homedir(), '.phaibel');

/** Secrets always live in ~/.phaibel/ — never in the foundation. */
export const SECRETS_PATH = path.join(SYSTEM_DIR, 'secrets.json');

// Daemon transient files
export const PID_FILE = path.join(SYSTEM_DIR, 'phaibel.pid');
export const SOCKET_PATH = path.join(SYSTEM_DIR, 'phaibel.sock');

/**
 * Resolve the Foundation root directory.
 * Falls back to ~/.phaibel/ if no foundation is found (e.g. daemon started outside foundation).
 */
export async function getFoundationDir(): Promise<string> {
    const root = await findFoundationRoot();
    return root || SYSTEM_DIR;
}

/**
 * Resolve the legacy .phaibel config directory: {foundation}/.phaibel/.
 * Falls back to ~/.phaibel/ if no foundation is found.
 */
export async function getVaultConfigDir(): Promise<string> {
    const root = await findFoundationRoot();
    if (root) {
        return path.join(root, '.phaibel');
    }
    return SYSTEM_DIR;
}

// ── Foundation-level paths (v5) ──────────────────────────────────────────────

export async function getContextTypesDir(): Promise<string> {
    return path.join(await getFoundationDir(), 'context-types');
}

export async function getProfilesDir(): Promise<string> {
    return path.join(await getFoundationDir(), 'profiles');
}

export async function getCollectionsDir(): Promise<string> {
    return path.join(await getFoundationDir(), 'collections');
}

export async function getFoundationLogsDir(): Promise<string> {
    return path.join(await getFoundationDir(), 'logs');
}

export async function getAccessLogPath(): Promise<string> {
    return path.join(await getFoundationDir(), 'logs', 'access.txt');
}

export async function getFeralRootDir(): Promise<string> {
    return path.join(await getFoundationDir(), 'feral');
}

export async function getFeralProcessesDir(): Promise<string> {
    return path.join(await getFoundationDir(), 'feral', 'processes');
}

export async function getFeralLogsDir(): Promise<string> {
    return path.join(await getFoundationDir(), 'feral', 'logs');
}

export async function getFeralCatalogDir(): Promise<string> {
    return path.join(await getFoundationDir(), 'feral', 'catalog');
}

export async function getContextTypeMappingPath(): Promise<string> {
    return path.join(await getFoundationDir(), 'context-types', 'mapping.json');
}

export async function getOpenApiSpecPath(): Promise<string> {
    return path.join(await getFoundationDir(), 'phaibel-cxms.oa3');
}

// ── Legacy vault-scoped config paths ─────────────────────────────────────────

export async function getConfigPath(): Promise<string> {
    return path.join(await getVaultConfigDir(), 'config.json');
}

export async function getEntityTypesPath(): Promise<string> {
    return path.join(await getVaultConfigDir(), 'entity-types.json');
}

export async function getFeralCatalogPath(): Promise<string> {
    return path.join(await getVaultConfigDir(), 'feral-catalog.json');
}

export async function getSkillsConfigPath(): Promise<string> {
    return path.join(await getVaultConfigDir(), 'skills.json');
}

export async function getAgentsConfigPath(): Promise<string> {
    return path.join(await getVaultConfigDir(), 'agents.json');
}

export async function getCalConfigPath(): Promise<string> {
    return path.join(await getVaultConfigDir(), 'cal-config.json');
}

export async function getEmbeddingsPath(): Promise<string> {
    return path.join(await getVaultConfigDir(), 'embeddings.json');
}

export async function getQueueStatePath(): Promise<string> {
    return path.join(await getVaultConfigDir(), 'queue-state.json');
}

export async function getCronConfigPath(): Promise<string> {
    return path.join(await getVaultConfigDir(), 'cron-config.json');
}

export async function getDaemonLogPath(): Promise<string> {
    return path.join(await getVaultConfigDir(), 'phaibel.log');
}

export async function getProcessesDir(): Promise<string> {
    return path.join(await getVaultConfigDir(), 'processes');
}

export async function getLogsDir(): Promise<string> {
    return path.join(await getVaultConfigDir(), 'logs');
}

export async function getPampDir(): Promise<string> {
    return path.join(await getVaultConfigDir(), 'pamp');
}
