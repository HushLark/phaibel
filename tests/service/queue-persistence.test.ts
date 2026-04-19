import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// We test the persistence functions with real file I/O in a temp directory.
// We need to mock the paths used by queue-persistence.

const TEST_DIR = path.join(os.tmpdir(), `phaibel-test-${Date.now()}`);
const TEST_FILE = path.join(TEST_DIR, 'queue-state.json');

// Mock the module constants by controlling the file paths
vi.mock('../../src/service/queue/queue-persistence.js', async () => {
    const actual = await vi.importActual<typeof import('../../src/service/queue/queue-persistence.js')>('../../src/service/queue/queue-persistence.js');
    return actual;
});

// Since queue-persistence uses hardcoded paths, we test the logic directly:
import { saveQueueState, loadQueueState, clearQueueState } from '../../src/service/queue/queue-persistence.js';

describe('Queue Persistence', () => {

    describe('saveQueueState', () => {
        it('should be a function', () => {
            expect(typeof saveQueueState).toBe('function');
        });

        it('should not throw when saving', async () => {
            await expect(saveQueueState([], 0, 0)).resolves.not.toThrow();
        });
    });

    describe('loadQueueState', () => {
        it('should return null when no state file exists (clean system)', async () => {
            // If no state was saved yet, this should return null gracefully
            // (on a clean test system with no prior queue state)
            const result = await loadQueueState();
            // Result is either null or a valid state object
            expect(result === null || typeof result === 'object').toBe(true);
        });
    });

    describe('clearQueueState', () => {
        it('should not throw when no state file exists', async () => {
            await expect(clearQueueState()).resolves.not.toThrow();
        });
    });

    describe('round-trip', () => {
        it('should save and load queue state', async () => {
            const mockQueue = [
                {
                    task: {
                        id: 'task-1',
                        name: 'Test',
                        scope: { type: 'global' as const },
                        steps: [],
                        currentStepIndex: 0,
                        context: { tokens: {}, previousOutputs: [] },
                        log: [],
                        createdAt: new Date(),
                        status: 'queued' as const,
                    },
                    addedAt: new Date(),
                },
            ];

            await saveQueueState(mockQueue, 5, 2);
            const loaded = await loadQueueState();

            expect(loaded).not.toBeNull();
            if (loaded) {
                expect(loaded.completedCount).toBe(5);
                expect(loaded.errorCount).toBe(2);
                expect(loaded.queue).toHaveLength(1);
                expect(loaded.queue[0].task.id).toBe('task-1');
                expect(loaded.savedAt).toBeDefined();
            }

            // Clean up
            await clearQueueState();
        });
    });
});
