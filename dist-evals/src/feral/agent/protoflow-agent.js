// ─────────────────────────────────────────────────────────────────────────────
// Feral Agent — ProtoFlow Agent
// ─────────────────────────────────────────────────────────────────────────────
import { DefaultContext } from '../context/context.js';
import { hydrateProcess } from '../process/process-json-hydrator.js';
import { AgentResult } from './agent.js';
/**
 * An agent that asks the brain to construct a process definition on-the-fly,
 * then executes it. The brain generates complete process JSON.
 */
export class ProtoFlowAgent {
    brain;
    engine;
    catalog;
    renderPrompt;
    maxIterations;
    constructor(brain, engine, catalog, renderPrompt, maxIterations = 5) {
        this.brain = brain;
        this.engine = engine;
        this.catalog = catalog;
        this.renderPrompt = renderPrompt;
        this.maxIterations = maxIterations;
    }
    async run(prompt, context) {
        const ctx = context ?? new DefaultContext();
        let iterations = 0;
        // Build available nodes description
        const nodesDescription = this.renderPrompt.renderCatalogDescription(this.catalog);
        while (iterations < this.maxIterations) {
            iterations++;
            const fullPrompt = [
                prompt,
                '',
                'You must design and return a process flow as JSON. The JSON must conform to this schema:',
                '{',
                '  "schema_version": 1,',
                '  "key": "agent-generated-process",',
                '  "context": {},',
                '  "nodes": [',
                '    { "key": "node_key", "catalog_node_key": "catalog_key", "configuration": {}, "edges": { "ok": "next_node_key" } }',
                '  ]',
                '}',
                '',
                'Available catalog nodes:',
                nodesDescription,
                '',
                `Current context keys: ${Object.keys(ctx.getAll()).join(', ') || '(empty)'}`,
                '',
                'The first node must be "start" (catalog_node_key: "start") and the last must be "end" (catalog_node_key: "stop").',
                'Respond ONLY with the JSON process definition.',
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
            if (thought.done && thought.action === 'error') {
                return {
                    status: AgentResult.FAILURE,
                    message: thought.reasoning,
                    context: ctx,
                    iterations,
                };
            }
            try {
                // The brain's "parameters" should contain the process JSON
                const processJson = thought.parameters;
                const process = hydrateProcess(processJson);
                await this.engine.process(process, ctx);
                return {
                    status: AgentResult.SUCCESS,
                    message: `Process executed successfully on iteration ${iterations}`,
                    context: ctx,
                    iterations,
                };
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                ctx.set('last_error', message);
                // Allow the brain to try again
                prompt = `Previous attempt failed with error: ${message}\n\nPlease fix the process and try again.\n\n${prompt}`;
            }
        }
        return {
            status: AgentResult.MAX_ITERATIONS,
            message: `ProtoFlow agent reached maximum iterations (${this.maxIterations})`,
            context: ctx,
            iterations,
        };
    }
}
