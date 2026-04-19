import { promises as fs } from 'fs';
import { debug } from '../../utils/debug.js';
import { getQueueStatePath, getVaultConfigDir } from '../../paths.js';
import type { Task } from '../protocol.js';

// ─────────────────────────────────────────────────────────────────────────────
// QUEUE PERSISTENCE
// ─────────────────────────────────────────────────────────────────────────────

interface PersistedQueueState {
    queue: { task: Task; addedAt: string }[];
    completedCount: number;
    errorCount: number;
    savedAt: string;
}

/**
 * Saves queue state to disk so it can survive daemon restarts.
 */
export async function saveQueueState(
    queue: { task: Task; addedAt: Date }[],
    completedCount: number,
    errorCount: number,
): Promise<void> {
    try {
        const dir = await getVaultConfigDir();
        await fs.mkdir(dir, { recursive: true });
        const statePath = await getQueueStatePath();
        const state: PersistedQueueState = {
            queue: queue.map(e => ({
                task: e.task,
                addedAt: e.addedAt.toISOString(),
            })),
            completedCount,
            errorCount,
            savedAt: new Date().toISOString(),
        };
        await fs.writeFile(statePath, JSON.stringify(state, null, 2));
    } catch (err) {
        console.debug('[phaibel:queue-persistence] Failed to save state:', (err as Error).message);
    }
}

/**
 * Loads queue state from disk. Returns null if no saved state exists.
 */
export async function loadQueueState(): Promise<PersistedQueueState | null> {
    try {
        const statePath = await getQueueStatePath();
        const data = await fs.readFile(statePath, 'utf-8');
        return JSON.parse(data) as PersistedQueueState;
    } catch (err) {
        debug('queue-persistence', err);
        return null;
    }
}

/**
 * Clears persisted queue state from disk.
 */
export async function clearQueueState(): Promise<void> {
    try {
        const statePath = await getQueueStatePath();
        await fs.unlink(statePath);
    } catch (err) {
        debug('queue-persistence', err);
    }
}
