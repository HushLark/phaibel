import type { Task, QueueStatus } from '../protocol.js';
import { QueueFullError } from '../protocol.js';
import { saveQueueState, loadQueueState, clearQueueState } from './queue-persistence.js';

// Queue configuration
const QUEUE_CONFIG = {
    maxSize: 10,
    defaultTimeoutMs: 30000,
};

interface QueueEntry {
    task: Task;
    addedAt: Date;
}

/**
 * Manages the task queue with size limits and receipt tracking.
 */
export class QueueManager {
    private queue: QueueEntry[] = [];
    private completed: Map<string, Task> = new Map();
    private completedCount = 0;
    private errorCount = 0;
    private waiters: Map<string, { resolve: (task: Task) => void; timeout: NodeJS.Timeout }> = new Map();

    /**
     * Add a task to the queue. Throws QueueFullError if at capacity.
     */
    enqueue(task: Task): string {
        if (this.isFull()) {
            throw new QueueFullError();
        }

        task.status = 'queued';
        task.createdAt = new Date();
        this.queue.push({ task, addedAt: new Date() });

        this.persistState();
        return task.id;
    }

    /**
     * Remove and return the next task from the queue.
     */
    dequeue(): Task | null {
        const entry = this.queue.shift();
        if (!entry) {
            return null;
        }
        entry.task.status = 'processing';
        entry.task.startedAt = new Date();
        return entry.task;
    }

    /**
     * Get a task by its ID (receipt).
     */
    getTask(taskId: string): Task | null {
        // Check active queue
        const entry = this.queue.find(e => e.task.id === taskId);
        if (entry) {
            return entry.task;
        }

        // Check completed
        return this.completed.get(taskId) || null;
    }

    /**
     * Update a task in the queue or completed map.
     */
    updateTask(taskId: string, updates: Partial<Task>): void {
        // Check active queue
        const entry = this.queue.find(e => e.task.id === taskId);
        if (entry) {
            Object.assign(entry.task, updates);
            return;
        }

        // Check completed
        const completedTask = this.completed.get(taskId);
        if (completedTask) {
            Object.assign(completedTask, updates);
        }
    }

    /**
     * Mark a task as completed and move to completed map.
     */
    completeTask(task: Task, error?: string): void {
        task.completedAt = new Date();

        if (error) {
            task.status = 'error';
            task.error = error;
            this.errorCount++;
        } else {
            task.status = 'completed';
            this.completedCount++;
        }

        this.completed.set(task.id, task);

        // Resolve any waiters
        const waiter = this.waiters.get(task.id);
        if (waiter) {
            clearTimeout(waiter.timeout);
            waiter.resolve(task);
            this.waiters.delete(task.id);
        }

        // Clean up old completed tasks (keep last 100)
        if (this.completed.size > 100) {
            const toDelete = Array.from(this.completed.keys()).slice(0, this.completed.size - 100);
            for (const id of toDelete) {
                this.completed.delete(id);
            }
        }

        this.persistState();
    }

    /**
     * Get current queue size.
     */
    size(): number {
        return this.queue.length;
    }

    /**
     * Get maximum queue size.
     */
    maxSize(): number {
        return QUEUE_CONFIG.maxSize;
    }

    /**
     * Check if queue is at capacity.
     */
    isFull(): boolean {
        return this.queue.length >= QUEUE_CONFIG.maxSize;
    }

    /**
     * Get full queue status.
     */
    getFullStatus(): QueueStatus {
        const processing = this.queue.filter(e => e.task.status === 'processing').length;

        return {
            size: this.queue.length,
            maxSize: QUEUE_CONFIG.maxSize,
            isFull: this.isFull(),
            processing,
            pending: this.queue.length - processing,
            completedCount: this.completedCount,
            errorCount: this.errorCount,
        };
    }

    /**
     * Clear all pending tasks from the queue.
     */
    clear(): number {
        const cleared = this.queue.length;
        this.queue = [];
        clearQueueState();
        return cleared;
    }

    /**
     * Wait for a task to complete.
     */
    waitForTask(taskId: string, timeoutMs: number = QUEUE_CONFIG.defaultTimeoutMs): Promise<Task> {
        // Check if already completed
        const completed = this.completed.get(taskId);
        if (completed) {
            return Promise.resolve(completed);
        }

        // Check if task exists
        const task = this.getTask(taskId);
        if (!task) {
            return Promise.reject(new Error(`Task not found: ${taskId}`));
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.waiters.delete(taskId);
                reject(new Error(`Timeout waiting for task: ${taskId}`));
            }, timeoutMs);

            this.waiters.set(taskId, { resolve, timeout });
        });
    }

    /**
     * Persist current queue state to disk.
     */
    private persistState(): void {
        saveQueueState(this.queue, this.completedCount, this.errorCount);
    }

    /**
     * Restore queue state from disk on startup.
     */
    async restoreState(): Promise<void> {
        const saved = await loadQueueState();
        if (!saved) return;

        // Only restore tasks that were still pending (not processing)
        for (const entry of saved.queue) {
            if (entry.task.status === 'queued') {
                this.queue.push({
                    task: entry.task,
                    addedAt: new Date(entry.addedAt),
                });
            }
        }
        this.completedCount = saved.completedCount;
        this.errorCount = saved.errorCount;

        if (this.queue.length > 0) {
            console.debug(`[phaibel:queue] Restored ${this.queue.length} pending tasks from disk`);
        }
    }
}

// Singleton instance
let queueManager: QueueManager | null = null;

export async function getQueueManager(): Promise<QueueManager> {
    if (!queueManager) {
        queueManager = new QueueManager();
        await queueManager.restoreState();
    }
    return queueManager;
}

export function resetQueueManager(): void {
    queueManager = null;
}
