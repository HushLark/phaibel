/**
 * Integration test helpers.
 *
 * Creates a real, temporary vault on disk so that entity tools can exercise
 * actual file I/O instead of mocked operations.
 */
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { beforeAll, afterAll } from 'vitest';
import { resetVaultCache, createProject, setActiveProject } from '../../src/state/manager.js';
import type { ServiceToolExecutionContext } from '../../src/tools/types.js';
import { getServiceTool } from '../../src/tools/types.js';
import type { TaskLogger } from '../../src/service/protocol.js';
import type { ContextProvider } from '../../src/service/context/provider.js';

// Import tool registrations (side-effects — registers tools in the global map)
import '../../src/tools/project.js';
import '../../src/tools/notes.js';
import '../../src/tools/tasks.js';
import '../../src/tools/events.js';
import '../../src/tools/goals.js';
import '../../src/tools/research.js';

// ─────────────────────────────────────────────────────────────────────────────
// VAULT LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

let vaultDir: string | null = null;
let originalCwd: string;

/**
 * Create a temporary vault with `.vault.md` and `.state.json`.
 * Changes `process.cwd()` to the vault root.
 */
export async function createTempVault(): Promise<string> {
    originalCwd = process.cwd();
    vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'phaibel-test-'));

    // Create the vault marker
    await fs.writeFile(path.join(vaultDir, '.vault.md'), '---\ntitle: Test Vault\n---\n');
    await fs.writeFile(path.join(vaultDir, '.state.json'), JSON.stringify({ activeProject: null }));

    // Reset the cached vault root so `findVaultRoot()` rescans
    resetVaultCache();

    // Change cwd so findVaultRoot discovers this vault
    process.chdir(vaultDir);

    return vaultDir;
}

/**
 * Remove the temporary vault and restore the original cwd.
 */
export async function destroyTempVault(): Promise<void> {
    if (originalCwd) {
        process.chdir(originalCwd);
    }
    resetVaultCache();
    if (vaultDir) {
        await fs.rm(vaultDir, { recursive: true, force: true });
        vaultDir = null;
    }
}

/**
 * Get the current temp vault path (for assertions).
 */
export function getVaultDir(): string {
    if (!vaultDir) throw new Error('No temp vault — call createTempVault() first');
    return vaultDir;
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP A TEST PROJECT
// ─────────────────────────────────────────────────────────────────────────────

const TEST_PROJECT = 'integration-test';

/**
 * Create and activate a test project in the temp vault.
 * Call this in `beforeAll()` after `createTempVault()`.
 */
export async function setupTestProject(): Promise<string> {
    await createProject(TEST_PROJECT);
    await setActiveProject(TEST_PROJECT);
    return TEST_PROJECT;
}

export { TEST_PROJECT };

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A real (non-mocked) logger that just swallows output.
 */
function createSilentLogger(): TaskLogger {
    return {
        debug: () => { },
        info: () => { },
        warn: () => { },
        error: () => { },
    };
}

/**
 * Minimal stubbed context provider; integration tests don't need context.
 */
function createStubContextProvider(): ContextProvider {
    return {
        getGlobalSymbols: () => new Map(),
        getSymbol: () => undefined,
        getTaskContext: () => ({ tokens: {}, previousOutputs: [] }),
        getTaskTokens: () => ({}),
        getGlobalContext: async () => '',
        getProjectContext: async () => '',
        getProjectContextChain: async () => '',
        getEntityContext: async () => '',
        getEntityContextChain: async () => '',
        getFullContext: async () => ({
            globalContext: '',
            projectContext: '',
            entityContext: '',
            symbols: new Map(),
            taskTokens: {},
            combined: '',
        }),
        invalidateCache: () => { },
    } as unknown as ContextProvider;
}

/**
 * Build a ServiceToolExecutionContext suitable for integration tests.
 * Uses silent logger and stub context — no mocks, no LLM.
 */
export function createIntegrationContext(): ServiceToolExecutionContext {
    return {
        taskId: 'integ-task',
        stepId: 'integ-step',
        ctx: createStubContextProvider(),
        previousOutputs: [],
        log: createSilentLogger(),
        llm: {
            chat: async () => 'stubbed LLM response',
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOL RUNNER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Look up a registered tool by name and execute it.
 */
export async function executeTool(name: string, input: Record<string, unknown> = {}) {
    const tool = getServiceTool(name);
    if (!tool) throw new Error(`Tool not registered: ${name}`);
    const ctx = createIntegrationContext();
    return tool.execute(input, ctx);
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMON LIFECYCLE HOOKS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convenience: call in `beforeAll` / `afterAll` for a standard test suite
 * that needs a temp vault + project.
 */
export function useTestVault() {
    beforeAll(async () => {
        await createTempVault();
        await setupTestProject();
    });

    afterAll(async () => {
        await destroyTempVault();
    });
}
