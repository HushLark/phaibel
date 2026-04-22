// ─────────────────────────────────────────────────────────────────────────────
// Feral Agent — Process Agent
// ─────────────────────────────────────────────────────────────────────────────
import { DefaultContext } from '../context/context.js';
import { AgentResult } from './agent.js';
/**
 * An agent that selects and runs processes from the catalog based on brain decisions.
 * The brain chooses which process to run from the available catalog.
 */
export class ProcessAgent {
    brain;
    runner;
    catalog;
    renderPrompt;
    maxIterations;
    constructor(brain, runner, catalog, renderPrompt, maxIterations = 10) {
        this.brain = brain;
        this.runner = runner;
        this.catalog = catalog;
        this.renderPrompt = renderPrompt;
        this.maxIterations = maxIterations;
    }
    async run(prompt, context) {
        const ctx = context ?? new DefaultContext();
        let iterations = 0;
        // Build catalog description for the brain
        const catalogDescription = this.renderPrompt.renderCatalogDescription(this.catalog);
        while (iterations < this.maxIterations) {
            iterations++;
            const fullPrompt = [
                prompt,
                '',
                'Available processes (choose one by key, or set done=true if complete):',
                catalogDescription,
                '',
                `Current context keys: ${Object.keys(ctx.getAll()).join(', ') || '(empty)'}`,
                `Iteration: ${iterations}/${this.maxIterations}`,
            ].join('\n');
            let thought;
            try {
                thought = await this.brain.think(fullPrompt);
            }
            catch (error) {
                return {
                    status: AgentResult.FAILURE,
                    message: `Brain error: ${error instanceof Error ? error.message : String(error)}`,
                    context: ctx,
                    iterations,
                };
            }
            if (thought.done) {
                return {
                    status: AgentResult.SUCCESS,
                    message: thought.reasoning,
                    context: ctx,
                    iterations,
                };
            }
            // Run the selected process
            try {
                const processKey = thought.action;
                // Inject brain parameters into context
                for (const [k, v] of Object.entries(thought.parameters)) {
                    ctx.set(k, v);
                }
                await this.runner.run(processKey, ctx.getAll());
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                ctx.set('last_error', message);
            }
        }
        return {
            status: AgentResult.MAX_ITERATIONS,
            message: `Agent reached maximum iterations (${this.maxIterations})`,
            context: ctx,
            iterations,
        };
    }
}
