// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Run Inline Process NodeCode
// ─────────────────────────────────────────────────────────────────────────────
//
// Reads a Feral process JSON from a context key, hydrates it, and executes it
// immediately with the SHARED context.  Unlike sub_process (which looks up a
// saved process by key) this runs a dynamically-constructed process — e.g. one
// generated on the fly by an LLM — without registering it in the factory.
//
// The engine's node-code cache is cleared before and after the inline run to
// prevent node-key collisions between the caller's process and the inline one.
//
// Requires __process_engine in context (injected by Runner.run()).
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import type { ProcessEngine } from '../../engine/process-engine.js';
import { hydrateProcess, type ProcessConfigJson } from '../../process/process-json-hydrator.js';

export class RunInlineProcessNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        {
            key: 'process_json_context_key',
            name: 'Process JSON Context Key',
            description: 'Context key holding the process JSON (object or JSON string) to execute inline with shared context.',
            type: 'string',
        },
    ];

    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK,    description: 'Inline process completed successfully.' },
        { status: ResultStatus.ERROR, description: 'Process JSON was invalid, missing, or execution failed.' },
    ];

    constructor() {
        super(
            'run_inline_process',
            'Run Inline Process',
            'Hydrate a Feral process from a context key and execute it inline, sharing the caller\'s context. Designed for LLM-generated processes.',
            NodeCodeCategory.FLOW,
        );
    }

    async process(context: Context): Promise<Result> {
        const contextKey = this.getRequiredConfigValue('process_json_context_key') as string;
        const raw = context.get(contextKey);

        const engine = context.get('__process_engine') as ProcessEngine | null;
        if (!engine) {
            return this.result(
                ResultStatus.ERROR,
                'run_inline_process requires __process_engine in context. Ensure you are running via Runner.run().',
            );
        }

        let processJson: ProcessConfigJson;
        if (typeof raw === 'string') {
            try {
                processJson = JSON.parse(raw) as ProcessConfigJson;
            } catch (e) {
                return this.result(ResultStatus.ERROR, `Invalid JSON in context key "${contextKey}": ${e}`);
            }
        } else if (raw && typeof raw === 'object') {
            processJson = raw as ProcessConfigJson;
        } else {
            return this.result(
                ResultStatus.ERROR,
                `Context key "${contextKey}" is empty or not a process JSON object.`,
            );
        }

        const processKey = processJson.key ?? '(unnamed)';

        try {
            // Clear the engine's per-node cache so the inline process gets
            // freshly-configured NodeCode instances (avoids key collisions with
            // whatever the calling process has already cached).
            engine.clearCache();

            const inlineProcess = hydrateProcess(processJson);
            await engine.process(inlineProcess, context);

            // Clear again so the parent process resumes with a clean cache.
            engine.clearCache();

            return this.result(ResultStatus.OK, `Inline process "${processKey}" completed.`);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            engine.clearCache();
            return this.result(ResultStatus.ERROR, `Inline process "${processKey}" failed: ${msg}`);
        }
    }
}
