// ─────────────────────────────────────────────────────────────────────────────
// PATHS — Central path resolution for Phaibel
// ─────────────────────────────────────────────────────────────────────────────
//
// Two root directories:
//   ~/.phaibel/              Secrets + daemon runtime (pid, sock)
//   {vault}/.phaibel/        All other config, logs, processes, caches
//
// The vault/.phaibel directory is the "working" config directory. Everything
// except LLM API keys and daemon transient files lives there.
// ─────────────────────────────────────────────────────────────────────────────

import path from 'path';
import os from 'os';
import { findVaultRoot } from './state/manager.js';

/** System-level directory — only secrets and daemon runtime. */
export const SYSTEM_DIR = path.join(os.homedir(), '.phaibel');

/** Secrets always live in ~/.phaibel/ — never in the vault. */
export const SECRETS_PATH = path.join(SYSTEM_DIR, 'secrets.json');

// Daemon transient files
export const PID_FILE = path.join(SYSTEM_DIR, 'phaibel.pid');
export const SOCKET_PATH = path.join(SYSTEM_DIR, 'phaibel.sock');

/**
 * Resolve the vault-scoped .phaibel directory: {vault}/.phaibel/.
 * Falls back to ~/.phaibel/ if no vault is found (e.g. daemon started outside vault).
 */
export async function getVaultConfigDir(): Promise<string> {
    const vaultRoot = await findVaultRoot();
    if (vaultRoot) {
        return path.join(vaultRoot, '.phaibel');
    }
    return SYSTEM_DIR;
}

// ── Vault-scoped config paths ────────────────────────────────────────────────

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
