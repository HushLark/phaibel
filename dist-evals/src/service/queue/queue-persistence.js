import { promises as fs } from 'fs';
import { debug } from '../../utils/debug.js';
import { getQueueStatePath, getVaultConfigDir } from '../../paths.js';
/**
 * Saves queue state to disk so it can survive daemon restarts.
 */
export async function saveQueueState(queue, completedCount, errorCount) {
    try {
        const dir = await getVaultConfigDir();
        await fs.mkdir(dir, { recursive: true });
        const statePath = await getQueueStatePath();
        const state = {
            queue: queue.map(e => ({
                task: e.task,
                addedAt: e.addedAt.toISOString(),
            })),
            completedCount,
            errorCount,
            savedAt: new Date().toISOString(),
        };
        await fs.writeFile(statePath, JSON.stringify(state, null, 2));
    }
    catch (err) {
        console.debug('[phaibel:queue-persistence] Failed to save state:', err.message);
    }
}
/**
 * Loads queue state from disk. Returns null if no saved state exists.
 */
export async function loadQueueState() {
    try {
        const statePath = await getQueueStatePath();
        const data = await fs.readFile(statePath, 'utf-8');
        return JSON.parse(data);
    }
    catch (err) {
        debug('queue-persistence', err);
        return null;
    }
}
/**
 * Clears persisted queue state from disk.
 */
export async function clearQueueState() {
    try {
        const statePath = await getQueueStatePath();
        await fs.unlink(statePath);
    }
    catch (err) {
        debug('queue-persistence', err);
    }
}
