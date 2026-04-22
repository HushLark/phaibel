// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Sub-Process NodeCode
// ─────────────────────────────────────────────────────────────────────────────
//
// Pauses the current process, runs a child process by key with the SAME
// shared context, then returns to the parent process.  This enables
// process composition — Process A can call Process B mid-execution.
//
// Requires __process_engine and __process_factory in context (injected
// by Runner.run() automatically).
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
export class SubProcessNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        {
            key: 'process_key',
            name: 'Process Key',
            description: 'The key of the sub-process to run. Supports {context_key} interpolation.',
            type: 'string',
        },
    ];
    static resultDescriptions = [
        { status: ResultStatus.OK, description: 'Sub-process completed successfully.' },
        { status: ResultStatus.ERROR, description: 'Sub-process failed or was not found.' },
    ];
    constructor() {
        super('sub_process', 'Sub-Process', 'Run another Feral process by key with shared context, then return to this process.', NodeCodeCategory.FLOW);
    }
    async process(context) {
        const processKeyTemplate = this.getRequiredConfigValue('process_key');
        // Interpolate {context_key} tokens in the process key
        const processKey = processKeyTemplate.replace(/\{(\w+)\}/g, (_, key) => {
            return String(context.get(key) ?? '');
        });
        const engine = context.get('__process_engine');
        const factory = context.get('__process_factory');
        if (!engine || !factory) {
            return this.result(ResultStatus.ERROR, 'Sub-process execution requires __process_engine and __process_factory in context. Ensure you are running via Runner.run().');
        }
        try {
            const subProcess = factory.build(processKey);
            await engine.process(subProcess, context);
            return this.result(ResultStatus.OK, `Sub-process "${processKey}" completed.`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.result(ResultStatus.ERROR, `Sub-process "${processKey}" failed: ${message}`);
        }
    }
}
