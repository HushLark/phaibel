// ─────────────────────────────────────────────────────────────────────────────
// Pipeline NodeCode — Factual Search
// ─────────────────────────────────────────────────────────────────────────────
//
// Runs the phaibel.factual sub-process (web search via Perplexity) and stores
// results in context for the synthesize step.
//
// Reads: user_input, __on_question, __on_status, __process_engine,
//        __process_factory, __classification
// Writes: __all_results, __all_reasonings, __process_source, __process_key
// Result: ok | error (both route to synthesize)
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import type { ProcessEngine } from '../../engine/process-engine.js';
import type { ProcessFactory } from '../../process/process-factory.js';
import { debug } from '../../../utils/debug.js';
import { scrubSecrets } from '../../../commands/chat-helpers.js';
import type { ClassificationResult } from '../../../context/request-classifier.js';

export class PipelineFactualSearchNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK,    description: 'Web search completed; results in __all_results.' },
        { status: ResultStatus.ERROR, description: 'Web search failed or phaibel.factual process not found.' },
    ];

    constructor() {
        super(
            'pipeline_factual_search',
            'Pipeline: Factual Search',
            'Runs the phaibel.factual web-search process and stores results for synthesis.',
            'pipeline',
        );
    }

    async process(context: Context): Promise<Result> {
        const userInput = context.getString('user_input') ?? '';
        const onStatus = context.get('__on_status') as ((s: string) => void) | null;
        const onQuestion = context.get('__on_question') as ((q: string, opts?: string[]) => Promise<string>) | null;
        const engine = context.get('__process_engine') as ProcessEngine | null;
        const factory = context.get('__process_factory') as ProcessFactory | null;
        const classification = context.get('__classification') as ClassificationResult | null;

        if (!engine || !factory) {
            return this.result(ResultStatus.ERROR, 'Factual search requires __process_engine and __process_factory in context.');
        }

        onStatus?.('Searching the web…');
        context.set('__process_source', 'category');
        context.set('__process_key', 'phaibel.factual');

        try {
            const factualProcess = factory.build('phaibel.factual');
            if (onQuestion) context.set('_askQuestion', onQuestion);

            engine.clearCache();
            await engine.process(factualProcess, context);
            engine.clearCache();

            // Collect results — filter out internal keys
            const allCtx = context.getAll();
            const filteredResult = Object.entries(allCtx)
                .filter(([k]) => !k.startsWith('_') && !k.startsWith('__') && k !== 'user_input')
                .reduce((acc, [k, v]) => {
                    acc[k] = typeof v === 'string' && v.length > 2000 ? v.slice(0, 2000) + '…' : v;
                    return acc;
                }, {} as Record<string, unknown>);

            const scrubbedResult = scrubSecrets(filteredResult) as Record<string, unknown>;
            context.set('__all_results', [scrubbedResult]);
            context.set('__all_reasonings', [
                `Category: factual — ${classification?.summary ?? 'web search result in context'}`,
            ]);

            debug('pipeline', `Factual search completed; context keys: ${Object.keys(filteredResult).join(', ')}`);
            return this.result(ResultStatus.OK, 'Factual search completed.');
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            debug('pipeline', `Factual search failed: ${msg}`);
            context.set('__all_results', [{ _error: msg }]);
            context.set('__all_reasonings', ['Factual web search failed.']);
            return this.result(ResultStatus.ERROR, msg);
        }
    }
}
