import type { Task, TaskStep, TaskLogger, TaskLogEntry, LogLevel, Canvas } from '../protocol.js';
import { QueueManager, getQueueManager } from './manager.js';
import { getServiceTool, type ServiceToolExecutionContext, type ServiceTool, type LLMProxy } from '../../tools/types.js';
import { bootstrapFeral } from '../../feral/bootstrap.js';
import { ContextProvider } from '../context/provider.js';
import { getModelForCapability, createSystemPrompt } from '../../llm/router.js';
import { z, type ZodTypeAny } from 'zod';

/**
 * Creates a TaskLogger bound to a specific step.
 */
function createTaskLogger(task: Task, stepId: string, toolName: string): TaskLogger {
    const log = (level: LogLevel, message: string, data?: unknown): void => {
        const entry: TaskLogEntry = {
            timestamp: new Date(),
            level,
            stepId,
            toolName,
            message,
            data,
        };
        task.log.push(entry);
    };

    return {
        debug: (message, data) => log('debug', message, data),
        info: (message, data) => log('info', message, data),
        warn: (message, data) => log('warn', message, data),
        error: (message, data) => log('error', message, data),
    };
}

/**
 * Creates an LLM proxy for tools to use.
 */
function createLLMProxy(tool: { capability?: string }): LLMProxy {
    return {
        async chat(messages, options) {
            const capability = tool.capability || 'reason';
            const model = await getModelForCapability(capability as 'summarize' | 'reason' | 'categorize');

            // Build system prompt
            let systemPrompt = options?.systemPrompt || '';
            if (!systemPrompt) {
                systemPrompt = createSystemPrompt('');
            }

            const response = await model.chat(
                messages.map(m => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
                { systemPrompt }
            );

            return response;
        },
    };
}

export interface ProcessorOptions {
    pollIntervalMs?: number;
}

/**
 * Processes tasks from the queue one by one.
 */
export class QueueProcessor {
    private running = false;
    private paused = false;
    private queueManager: QueueManager | null = null;
    private pollIntervalMs: number;
    private pollTimeout: NodeJS.Timeout | null = null;

    constructor(options: ProcessorOptions = {}) {
        this.pollIntervalMs = options.pollIntervalMs ?? 100;
    }

    /**
     * Start processing the queue.
     */
    async start(): Promise<void> {
        if (this.running) return;
        this.queueManager = await getQueueManager();
        this.running = true;
        this.processLoop();
    }

    /**
     * Stop processing.
     */
    stop(): void {
        this.running = false;
        if (this.pollTimeout) {
            clearTimeout(this.pollTimeout);
            this.pollTimeout = null;
        }
    }

    /**
     * Pause processing (queue still accepts tasks).
     */
    pause(): void {
        this.paused = true;
    }

    /**
     * Resume processing.
     */
    resume(): void {
        this.paused = false;
    }

    /**
     * Check if paused.
     */
    isPaused(): boolean {
        return this.paused;
    }

    /**
     * Check if running.
     */
    isRunning(): boolean {
        return this.running;
    }

    /**
     * Main processing loop.
     */
    private async processLoop(): Promise<void> {
        while (this.running) {
            if (!this.paused && this.queueManager) {
                const task = this.queueManager.dequeue();
                if (task) {
                    await this.processTask(task);
                }
            }

            // Poll interval
            await new Promise<void>((resolve) => {
                this.pollTimeout = setTimeout(resolve, this.pollIntervalMs);
            });
        }
    }

    /**
     * Process a single task through all its steps.
     */
    private async processTask(task: Task): Promise<void> {
        try {
            task.startedAt = new Date();
            task.status = 'processing';

            // Create context provider for this task
            const ctx = await ContextProvider.create(task.context);

            for (let i = 0; i < task.steps.length; i++) {
                if (!this.running || this.paused) {
                    // Re-queue the task if we're stopping or pausing
                    task.status = 'paused';
                    return;
                }

                task.currentStepIndex = i;
                const step = task.steps[i];

                await this.processStep(task, step, ctx);

                if (step.status === 'error') {
                    // Stop on error
                    task.error = step.error;
                    this.queueManager!.completeTask(task, step.error);
                    return;
                }

                // Add step output to previousOutputs
                if (step.output !== undefined) {
                    task.context.previousOutputs.push(step.output);
                }
            }

            this.queueManager!.completeTask(task);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.queueManager!.completeTask(task, errorMessage);
        }
    }

    /**
     * Process a single step by looking up and executing the appropriate tool.
     */
    private async processStep(task: Task, step: TaskStep, ctx: ContextProvider): Promise<void> {
        step.startedAt = new Date();
        step.status = 'running';

        const logger = createTaskLogger(task, step.id, step.toolName);

        try {
            logger.info(`Starting step: ${step.toolName}`);

            // Look up the service tool — Feral registry first, then manual registry
            const feral = await bootstrapFeral();
            const tool = feral.toolRegistry.getTool(step.toolName) ?? getServiceTool(step.toolName);

            if (!tool) {
                throw new Error(`Tool not found: ${step.toolName}`);
            }

            // Validate input against schema
            const validatedInput = validateToolInput(tool, step.input, logger);

            // Create execution context
            const execContext: ServiceToolExecutionContext = {
                taskId: task.id,
                stepId: step.id,
                sessionId: task.sessionId,
                ctx,
                previousOutputs: task.context.previousOutputs,
                canvas: task.context.canvas,
                log: logger,
                llm: createLLMProxy(tool),
            };

            // Execute the tool
            const result = await tool.execute(validatedInput, execContext);

            // Process result
            step.output = result.output;

            if (!result.success) {
                throw new Error(result.error || 'Tool execution failed');
            }

            // Apply tokens if any
            if (result.tokensToSet) {
                for (const [key, value] of Object.entries(result.tokensToSet)) {
                    task.context.tokens[key] = value;
                }
            }

            // Apply canvas update if any
            if (result.canvasUpdate) {
                if (task.context.canvas) {
                    task.context.canvas = { ...task.context.canvas, ...result.canvasUpdate };
                } else {
                    task.context.canvas = result.canvasUpdate as Canvas;
                }
            }

            step.status = 'completed';
            step.completedAt = new Date();
            step.durationMs = step.completedAt.getTime() - step.startedAt.getTime();

            logger.info(`Completed step: ${step.toolName}`, { durationMs: step.durationMs });
        } catch (error) {
            step.status = 'error';
            step.error = error instanceof Error ? error.message : 'Unknown error';
            step.completedAt = new Date();
            step.durationMs = step.completedAt.getTime() - step.startedAt.getTime();

            logger.error(`Step failed: ${step.toolName}`, { error: step.error });
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// INPUT VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a ServiceTool inputSchema property to a Zod type.
 */
function schemaPropertyToZod(prop: { type: string; items?: { type: string } }): ZodTypeAny {
    switch (prop.type) {
        case 'string': return z.string();
        case 'number': return z.number();
        case 'boolean': return z.boolean();
        case 'array':
            if (prop.items?.type === 'number') return z.array(z.number());
            if (prop.items?.type === 'boolean') return z.array(z.boolean());
            return z.array(z.string());
        default: return z.unknown();
    }
}

/**
 * Builds a Zod schema from a ServiceTool's inputSchema definition.
 */
function buildZodSchema(tool: ServiceTool): z.ZodObject<Record<string, ZodTypeAny>> | null {
    if (!tool.inputSchema?.properties) return null;

    const shape: Record<string, ZodTypeAny> = {};
    const required = new Set(tool.inputSchema.required || []);

    for (const [key, prop] of Object.entries(tool.inputSchema.properties)) {
        let zodType = schemaPropertyToZod(prop);
        if (!required.has(key) && !prop.required) {
            zodType = zodType.optional();
        }
        shape[key] = zodType;
    }

    return z.object(shape).passthrough();
}

/**
 * Validates tool input against its schema. Returns validated input or throws.
 */
function validateToolInput(tool: ServiceTool, input: unknown, logger: TaskLogger): unknown {
    const schema = buildZodSchema(tool);
    if (!schema) return input; // No schema defined, pass through

    const result = schema.safeParse(input);
    if (!result.success) {
        const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
        logger.warn(`Input validation failed for ${tool.name}: ${issues}`);
        throw new Error(`Invalid input for tool '${tool.name}': ${issues}`);
    }
    return result.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────

let processor: QueueProcessor | null = null;

export function getQueueProcessor(): QueueProcessor {
    if (!processor) {
        processor = new QueueProcessor();
    }
    return processor;
}

export function resetQueueProcessor(): void {
    if (processor) {
        processor.stop();
    }
    processor = null;
}
