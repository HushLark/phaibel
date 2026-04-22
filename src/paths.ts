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

import { getPlatform } from './platform/index.js';
import { findFoundationRoot, findVaultRoot } from './state/manager.js';

function join(...parts: string[]): string {
    return getPlatform().paths.join(...parts);
}

/** System-level directory — only secrets and daemon runtime. */
export function SYSTEM_DIR(): string {
    return join(getPlatform().homedir(), '.phaibel');
}

/** Secrets always live in ~/.phaibel/ — never in the foundation. */
export function SECRETS_PATH(): string {
    return join(SYSTEM_DIR(), 'secrets.json');
}

// Daemon transient files
export function PID_FILE(): string {
    return join(SYSTEM_DIR(), 'phaibel.pid');
}
export function SOCKET_PATH(): string {
    return join(SYSTEM_DIR(), 'phaibel.sock');
}

/**
 * Resolve the Foundation root directory.
 * Falls back to ~/.phaibel/ if no foundation is found (e.g. daemon started outside foundation).
 */
export async function getFoundationDir(): Promise<string> {
    const root = await findFoundationRoot();
    return root || SYSTEM_DIR();
}

/**
 * Resolve the legacy .phaibel config directory: {foundation}/.phaibel/.
 * Falls back to ~/.phaibel/ if no foundation is found.
 */
export async function getVaultConfigDir(): Promise<string> {
    const root = await findFoundationRoot();
    if (root) {
        return join(root, '.phaibel');
    }
    return SYSTEM_DIR();
}

// ── Foundation-level paths (v5) ──────────────────────────────────────────────

export async function getContextTypesDir(): Promise<string> {
    return join(await getFoundationDir(), 'context-types');
}

export async function getProfilesDir(): Promise<string> {
    return join(await getFoundationDir(), 'profiles');
}

export async function getCollectionsDir(): Promise<string> {
    return join(await getFoundationDir(), 'collections');
}

export async function getFoundationLogsDir(): Promise<string> {
    return join(await getFoundationDir(), 'logs');
}

export async function getAccessLogPath(): Promise<string> {
    return join(await getFoundationDir(), 'logs', 'access.txt');
}

export async function getFeralRootDir(): Promise<string> {
    return join(await getFoundationDir(), 'feral');
}

export async function getFeralProcessesDir(): Promise<string> {
    return join(await getFoundationDir(), 'feral', 'processes');
}

export async function getFeralLogsDir(): Promise<string> {
    return join(await getFoundationDir(), 'feral', 'logs');
}

export async function getFeralCatalogDir(): Promise<string> {
    return join(await getFoundationDir(), 'feral', 'catalog');
}

export async function getContextTypeMappingPath(): Promise<string> {
    return join(await getFoundationDir(), 'context-types', 'mapping.json');
}

export async function getOpenApiSpecPath(): Promise<string> {
    return join(await getFoundationDir(), 'phaibel-cxms.oa3');
}

// ── Legacy vault-scoped config paths ─────────────────────────────────────────

export async function getConfigPath(): Promise<string> {
    return join(await getVaultConfigDir(), 'config.json');
}

export async function getEntityTypesPath(): Promise<string> {
    return join(await getVaultConfigDir(), 'entity-types.json');
}

export async function getFeralCatalogPath(): Promise<string> {
    return join(await getVaultConfigDir(), 'feral-catalog.json');
}

export async function getSkillsConfigPath(): Promise<string> {
    return join(await getVaultConfigDir(), 'skills.json');
}

export async function getAgentsConfigPath(): Promise<string> {
    return join(await getVaultConfigDir(), 'agents.json');
}

export async function getCalConfigPath(): Promise<string> {
    return join(await getVaultConfigDir(), 'cal-config.json');
}

export async function getEmbeddingsPath(): Promise<string> {
    return join(await getVaultConfigDir(), 'embeddings.json');
}

export async function getQueueStatePath(): Promise<string> {
    return join(await getVaultConfigDir(), 'queue-state.json');
}

export async function getCronConfigPath(): Promise<string> {
    return join(await getVaultConfigDir(), 'cron-config.json');
}

export async function getDaemonLogPath(): Promise<string> {
    return join(await getVaultConfigDir(), 'phaibel.log');
}

export async function getProcessesDir(): Promise<string> {
    return join(await getVaultConfigDir(), 'processes');
}

export async function getLogsDir(): Promise<string> {
    return join(await getVaultConfigDir(), 'logs');
}

export async function getPampDir(): Promise<string> {
    return join(await getVaultConfigDir(), 'pamp');
}

export async function getCxfSyncStatePath(): Promise<string> {
    return join(await getVaultConfigDir(), 'cxf-sync.json');
}

export async function getCxfSystemsPath(): Promise<string> {
    return join(await getVaultConfigDir(), 'cxf-systems.json');
}

export async function getSkillsDir(): Promise<string> {
    return join(await getFoundationDir(), 'skills');
}
