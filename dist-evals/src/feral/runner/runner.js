// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Runner
// ─────────────────────────────────────────────────────────────────────────────
import { DefaultContext } from '../context/context.js';
/**
 * High-level API to run a process by key with initial context values.
 */
export class Runner {
    processFactory;
    engine;
    constructor(processFactory, engine) {
        this.processFactory = processFactory;
        this.engine = engine;
    }
    async run(processKey, contextValues = {}) {
        const context = new DefaultContext();
        for (const [k, v] of Object.entries(contextValues)) {
            context.set(k, v);
        }
        // Inject engine & factory so SubProcessNodeCode can call sub-processes
        context.set('__process_engine', this.engine);
        context.set('__process_factory', this.processFactory);
        const process = this.processFactory.build(processKey);
        await this.engine.process(process, context);
        return context;
    }
}
