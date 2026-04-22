import { randomUUID } from 'crypto';
/**
 * Fluent builder for creating multi-step tasks.
 */
export class TaskBuilder {
    task;
    steps = [];
    constructor(name) {
        this.task = {
            id: randomUUID(),
            name,
            scope: { type: 'global' },
            steps: [],
            currentStepIndex: 0,
            context: {
                tokens: {},
                previousOutputs: [],
            },
            log: [],
            createdAt: new Date(),
            status: 'queued',
        };
    }
    static create(name) {
        return new TaskBuilder(name);
    }
    /**
     * Set task scope to a specific project.
     */
    forProject(projectName) {
        this.task.scope = { type: 'project', projectName };
        return this;
    }
    /**
     * Set task scope to global (vault-wide).
     */
    forGlobal() {
        this.task.scope = { type: 'global' };
        return this;
    }
    /**
     * Bind task to a session.
     */
    forSession(sessionId) {
        this.task.sessionId = sessionId;
        return this;
    }
    /**
     * Set the entity type for context loading.
     */
    forEntity(entity) {
        if (this.task.context) {
            this.task.context.entity = entity;
        }
        return this;
    }
    /**
     * Set initial canvas.
     */
    withCanvas(canvas) {
        if (this.task.context) {
            this.task.context.canvas = canvas;
        }
        return this;
    }
    /**
     * Set initial tokens.
     */
    withTokens(tokens) {
        if (this.task.context) {
            for (const [key, value] of Object.entries(tokens)) {
                this.task.context.tokens[key] = value;
            }
        }
        return this;
    }
    /**
     * Add a step to the task.
     */
    addStep(toolName, input) {
        const step = {
            id: randomUUID(),
            toolName,
            input,
            status: 'pending',
        };
        this.steps.push(step);
        return this;
    }
    /**
     * Build the final task.
     */
    build() {
        return {
            ...this.task,
            steps: this.steps,
        };
    }
}
