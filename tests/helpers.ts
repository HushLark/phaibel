/**
 * Shared test helpers and mock factories for Phaibel tests.
 */
import { vi } from 'vitest';
import type { Task, TaskStep, TaskContext, TaskLogger, Canvas } from '../src/service/protocol.js';
import type { ServiceToolExecutionContext, LLMProxy, ServiceToolResult } from '../src/tools/types.js';
import type { ContextProvider } from '../src/service/context/provider.js';

// ─────────────────────────────────────────────────────────────────────────────
// MOCK TASK LOGGER
// ─────────────────────────────────────────────────────────────────────────────

export function createMockLogger(): TaskLogger {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// MOCK LLM PROXY
// ─────────────────────────────────────────────────────────────────────────────

export function createMockLLM(response: string = 'mock LLM response'): LLMProxy {
    return {
        chat: vi.fn().mockResolvedValue(response),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// MOCK CONTEXT PROVIDER
// ─────────────────────────────────────────────────────────────────────────────

export function createMockContextProvider(): ContextProvider {
    return {
        getGlobalSymbols: vi.fn().mockReturnValue(new Map()),
        getSymbol: vi.fn().mockReturnValue(undefined),
        getTaskContext: vi.fn().mockReturnValue(createMockTaskContext()),
        getTaskTokens: vi.fn().mockReturnValue({}),
        getGlobalContext: vi.fn().mockResolvedValue('global context'),
        getProjectContext: vi.fn().mockResolvedValue('project context'),
        getProjectContextChain: vi.fn().mockResolvedValue('project chain'),
        getEntityContext: vi.fn().mockResolvedValue('entity context'),
        getEntityContextChain: vi.fn().mockResolvedValue('entity chain'),
        getFullContext: vi.fn().mockResolvedValue({
            globalContext: 'global context',
            projectContext: 'project context',
            entityContext: 'entity context',
            symbols: new Map(),
            taskTokens: {},
            combined: 'global context\n\n---\n\nproject context\n\n---\n\nentity context',
        }),
        invalidateCache: vi.fn(),
    } as unknown as ContextProvider;
}

// ─────────────────────────────────────────────────────────────────────────────
// MOCK TASK CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

export function createMockTaskContext(overrides: Partial<TaskContext> = {}): TaskContext {
    return {
        tokens: {},
        previousOutputs: [],
        ...overrides,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// MOCK EXECUTION CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

export function createMockExecutionContext(overrides: Partial<ServiceToolExecutionContext> = {}): ServiceToolExecutionContext {
    return {
        taskId: 'test-task-id',
        stepId: 'test-step-id',
        ctx: createMockContextProvider(),
        previousOutputs: [],
        log: createMockLogger(),
        llm: createMockLLM(),
        ...overrides,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// MOCK TASK STEP
// ─────────────────────────────────────────────────────────────────────────────

export function createMockStep(overrides: Partial<TaskStep> = {}): TaskStep {
    return {
        id: 'step-1',
        toolName: 'test-tool',
        input: {},
        status: 'pending',
        ...overrides,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// MOCK TASK
// ─────────────────────────────────────────────────────────────────────────────

export function createMockTask(overrides: Partial<Task> = {}): Task {
    return {
        id: `task-${Date.now()}`,
        name: 'Test Task',
        scope: { type: 'global' },
        steps: [createMockStep()],
        currentStepIndex: 0,
        context: createMockTaskContext(),
        log: [],
        createdAt: new Date(),
        status: 'queued',
        ...overrides,
    };
}
