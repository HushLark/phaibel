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
import { findFoundationRoot } from './state/manager.js';
function join(...parts) {
    return getPlatform().paths.join(...parts);
}
/** System-level directory — only secrets and daemon runtime. */
export function SYSTEM_DIR() {
    return join(getPlatform().homedir(), '.phaibel');
}
/** Secrets always live in ~/.phaibel/ — never in the foundation. */
export function SECRETS_PATH() {
    return join(SYSTEM_DIR(), 'secrets.json');
}
// Daemon transient files
export function PID_FILE() {
    return join(SYSTEM_DIR(), 'phaibel.pid');
}
export function SOCKET_PATH() {
    return join(SYSTEM_DIR(), 'phaibel.sock');
}
/**
 * Resolve the Foundation root directory.
 * Falls back to ~/.phaibel/ if no foundation is found (e.g. daemon started outside foundation).
 */
export async function getFoundationDir() {
    const root = await findFoundationRoot();
    return root || SYSTEM_DIR();
}
/**
 * Resolve the legacy .phaibel config directory: {foundation}/.phaibel/.
 * Falls back to ~/.phaibel/ if no foundation is found.
 */
export async function getVaultConfigDir() {
    const root = await findFoundationRoot();
    if (root) {
        return join(root, '.phaibel');
    }
    return SYSTEM_DIR();
}
// ── Foundation-level paths (v5) ──────────────────────────────────────────────
export async function getContextTypesDir() {
    return join(await getFoundationDir(), 'context-types');
}
export async function getProfilesDir() {
    return join(await getFoundationDir(), 'profiles');
}
export async function getCollectionsDir() {
    return join(await getFoundationDir(), 'collections');
}
export async function getFoundationLogsDir() {
    return join(await getFoundationDir(), 'logs');
}
export async function getAccessLogPath() {
    return join(await getFoundationDir(), 'logs', 'access.txt');
}
export async function getFeralRootDir() {
    return join(await getFoundationDir(), 'feral');
}
export async function getFeralProcessesDir() {
    return join(await getFoundationDir(), 'feral', 'processes');
}
export async function getFeralLogsDir() {
    return join(await getFoundationDir(), 'feral', 'logs');
}
export async function getFeralCatalogDir() {
    return join(await getFoundationDir(), 'feral', 'catalog');
}
export async function getContextTypeMappingPath() {
    return join(await getFoundationDir(), 'context-types', 'mapping.json');
}
export async function getOpenApiSpecPath() {
    return join(await getFoundationDir(), 'phaibel-cxms.oa3');
}
// ── Legacy vault-scoped config paths ─────────────────────────────────────────
export async function getConfigPath() {
    return join(await getVaultConfigDir(), 'config.json');
}
export async function getEntityTypesPath() {
    return join(await getVaultConfigDir(), 'entity-types.json');
}
export async function getFeralCatalogPath() {
    return join(await getVaultConfigDir(), 'feral-catalog.json');
}
export async function getSkillsConfigPath() {
    return join(await getVaultConfigDir(), 'skills.json');
}
export async function getAgentsConfigPath() {
    return join(await getVaultConfigDir(), 'agents.json');
}
export async function getCalConfigPath() {
    return join(await getVaultConfigDir(), 'cal-config.json');
}
export async function getEmbeddingsPath() {
    return join(await getVaultConfigDir(), 'embeddings.json');
}
export async function getQueueStatePath() {
    return join(await getVaultConfigDir(), 'queue-state.json');
}
export async function getCronConfigPath() {
    return join(await getVaultConfigDir(), 'cron-config.json');
}
export async function getDaemonLogPath() {
    return join(await getVaultConfigDir(), 'phaibel.log');
}
export async function getProcessesDir() {
    return join(await getVaultConfigDir(), 'processes');
}
export async function getLogsDir() {
    return join(await getVaultConfigDir(), 'logs');
}
export async function getPampDir() {
    return join(await getVaultConfigDir(), 'pamp');
}
export async function getCxfSyncStatePath() {
    return join(await getVaultConfigDir(), 'cxf-sync.json');
}
export async function getCxfSystemsPath() {
    return join(await getVaultConfigDir(), 'cxf-systems.json');
}
export async function getSkillsDir() {
    return join(await getFoundationDir(), 'skills');
}
