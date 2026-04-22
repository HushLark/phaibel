// ─────────────────────────────────────────────────────────────────────────────
// CXF Sync State — tracks per-consumer last-sync timestamps.
// Stored at {foundation}/.phaibel/cxf-sync.json.
// ─────────────────────────────────────────────────────────────────────────────
import { getPlatform } from '../platform/index.js';
import { getVaultConfigDir } from '../paths.js';
const DEFAULT_STATE = { consumers: {} };
async function syncStatePath() {
    const dir = await getVaultConfigDir();
    return getPlatform().paths.join(dir, 'cxf-sync.json');
}
export async function loadSyncState() {
    try {
        const raw = await getPlatform().storage.readFile(await syncStatePath());
        return JSON.parse(raw);
    }
    catch {
        return { ...DEFAULT_STATE, consumers: {} };
    }
}
export async function saveSyncState(state) {
    const { storage } = getPlatform();
    const dir = await getVaultConfigDir();
    await storage.mkdir(dir, { recursive: true });
    await storage.writeFile(await syncStatePath(), JSON.stringify(state, null, 2));
}
/** Records a successful sync for a consumer. Returns the Unix seconds timestamp used. */
export async function recordSync(consumerId) {
    const now = Math.floor(Date.now() / 1000);
    const state = await loadSyncState();
    const existing = state.consumers[consumerId];
    state.consumers[consumerId] = {
        lastSyncAt: now,
        firstSyncAt: existing?.firstSyncAt ?? now,
        syncCount: (existing?.syncCount ?? 0) + 1,
    };
    await saveSyncState(state);
    return now;
}
export async function getLastSync(consumerId) {
    const state = await loadSyncState();
    return state.consumers[consumerId]?.lastSyncAt ?? null;
}
export async function getAllConsumers() {
    const state = await loadSyncState();
    return state.consumers;
}
/**
 * Returns true if any registered consumer has NOT synced since deletedAtUnix.
 * Used to determine whether to keep emitting a tombstone.
 */
export async function shouldIncludeTombstone(deletedAtUnix) {
    const consumers = await getAllConsumers();
    const ids = Object.keys(consumers);
    if (ids.length === 0)
        return true; // no consumers registered — keep emitting
    return ids.some(id => consumers[id].lastSyncAt < deletedAtUnix);
}
