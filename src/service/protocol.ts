// Service protocol types for IPC communication

// ─────────────────────────────────────────────────────────────────────────────
// TASK SCOPE
// ─────────────────────────────────────────────────────────────────────────────

export type TaskScope =
    | { type: 'global' }
    | { type: 'project'; projectName: string };

// ─────────────────────────────────────────────────────────────────────────────
// ENTITY TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type EntityType = 'notes' | 'todos' | 'events' | 'research' | 'goals' | 'inbox' | 'people';

// ─────────────────────────────────────────────────────────────────────────────
// LOG TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface TaskLogEntry {
    timestamp: Date;
    level: LogLevel;
    stepId: string;
    toolName: string;
    message: string;
    data?: unknown;
}

export interface TaskLogger {
    debug(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// CANVAS
// ─────────────────────────────────────────────────────────────────────────────

export interface Canvas {
    type: 'note' | 'todo' | 'event' | 'research' | 'goal' | 'generic';
    title: string;
    content: string;
    metadata?: Record<string, unknown>;
    dirty: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

export interface TaskContext {
    tokens: Record<string, string>;
    previousOutputs: unknown[];
    canvas?: Canvas;
    entity?: EntityType;
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK STEP
// ─────────────────────────────────────────────────────────────────────────────

export type TaskStepStatus = 'pending' | 'running' | 'completed' | 'error' | 'skipped';

export interface TaskStep {
    id: string;
    toolName: string;
    input: unknown;
    output?: unknown;
    startedAt?: Date;
    completedAt?: Date;
    durationMs?: number;
    status: TaskStepStatus;
    error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK
// ─────────────────────────────────────────────────────────────────────────────

export type TaskStatus = 'queued' | 'processing' | 'completed' | 'error' | 'paused';

export interface Task {
    id: string;
    name: string;
    scope: TaskScope;
    sessionId?: string;
    steps: TaskStep[];
    currentStepIndex: number;
    context: TaskContext;
    log: TaskLogEntry[];
    createdAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    status: TaskStatus;
    error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE REQUEST/RESPONSE
// ─────────────────────────────────────────────────────────────────────────────

export type QueryPayload =
    | { query: 'queue.size' }
    | { query: 'queue.status' }
    | { query: 'service.memory' }
    | { query: 'index.stats' }
    | { query: 'index.graph' }
    | { query: 'index.neighbors'; key: string }
    | { query: 'index.rebuild' }
    | { query: 'task.status'; taskId: string };

export type ControlPayload =
    | { control: 'queue.clear'; confirm: boolean }
    | { control: 'queue.pause' }
    | { control: 'queue.resume' };

export interface ServiceRequest {
    id: string;
    type: 'task' | 'query' | 'control';
    sessionId?: string;
    payload: Task | QueryPayload | ControlPayload;
}

export type ServiceResponseStatus = 'queued' | 'processing' | 'completed' | 'error';

export interface ServiceResponse {
    requestId: string;
    status: ServiceResponseStatus;
    result?: unknown;
    error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// QUEUE STATUS
// ─────────────────────────────────────────────────────────────────────────────

export interface QueueStatus {
    size: number;
    maxSize: number;
    isFull: boolean;
    processing: number;
    pending: number;
    completedCount: number;
    errorCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// ERRORS
// ─────────────────────────────────────────────────────────────────────────────

export class QueueFullError extends Error {
    constructor() {
        super('Queue is at maximum capacity (10). Please wait for tasks to complete.');
        this.name = 'QueueFullError';
    }
}

export class ServiceNotRunningError extends Error {
    constructor() {
        super('Service is not running. Start it with: phaibel start');
        this.name = 'ServiceNotRunningError';
    }
}
