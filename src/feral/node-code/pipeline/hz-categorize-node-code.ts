// ─────────────────────────────────────────────────────────────────────────────
// Hertz Pipeline — Step 1: Categorize
// ─────────────────────────────────────────────────────────────────────────────
//
// Lightweight classification: safety check, category, and intent summary.
// Unlike Cruel Summer's categorize, this does NOT do structured extraction —
// that thinking belongs in hz_plan, which runs as a dedicated chain-of-thought
// step before execution.
//
// Reads: user_input, __history, __hz_retry_count
// Writes: __classification, __request_weights, __hz_category,
//         __hz_intent_summary, __hz_request_type
// Result: "ok" (→ hz_plan) | "chat" (→ hz_synthesize) | "blocked" | "error"
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { classifyRequest, BLOCKED_RESPONSE } from '../../../context/request-classifier.js';
import { inferWeights } from '../../../context/request-weights.js';
import { getModelForCapability } from '../../../llm/router.js';
import { debug } from '../../../utils/debug.js';
import type { ChatHistoryEntry } from '../../../commands/chat-helpers.js';

export class HZCategorizeNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: 'ok',               description: 'Request categorized — proceed to planning.' },
        { status: 'chat',             description: 'Phatic exchange — route directly to synthesis.' },
        { status: 'blocked',          description: 'Guardrail triggered — stop processing.' },
        { status: ResultStatus.ERROR, description: 'Classification failed — proceed to planning with defaults.' },
    ];

    constructor() {
        super(
            'hz_categorize',
            'Hz: Categorize Request',
            'Classifies request intent and routes to planning or synthesis fast-path. Step 1 of Hertz.',
            'pipeline',
        );
    }

    async process(context: Context): Promise<Result> {
        const userInput = context.getString('user_input') ?? '';
        const history = (context.get('__history') as ChatHistoryEntry[] | null) ?? [];
        const retryCount = (context.get('__hz_retry_count') as number | null) ?? 0;
        const onStatus = context.get('__on_status') as ((s: string) => void) | null;

        onStatus?.(retryCount > 0 ? `Re-analyzing (attempt ${retryCount + 1})…` : 'Analyzing request…');

        let classification;
        try {
            const categorizeLlm = await getModelForCapability('categorize');
            classification = await classifyRequest(categorizeLlm, userInput, history);
        } catch (err) {
            debug('pipeline', `Hz categorize failed: ${err}`);
            context.set('__hz_category', 'action');
            context.set('__hz_intent_summary', userInput);
            context.set('__hz_request_type', 'action');
            return this.result(ResultStatus.ERROR, `Classification failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        if (classification.blocked) {
            context.set('__pipeline_response', BLOCKED_RESPONSE);
            return this.result('blocked', 'Request blocked.');
        }

        const weights = inferWeights(classification);
        context.set('__classification', classification);
        context.set('__request_weights', weights);
        context.set('__hz_category', classification.category);
        context.set('__hz_intent_summary', classification.summary ?? userInput);

        const cat = classification.category;
        const requestType = (cat === 'query' || cat === 'introspection' || cat === 'analytical')
            ? 'query'
            : (cat === 'remember') ? 'remember'
            : (cat === 'create')   ? 'create'
            : 'action';
        context.set('__hz_request_type', requestType);

        if (cat === 'chat') {
            return this.result('chat', 'Phatic exchange — direct to synthesis.');
        }

        debug('pipeline', `Hz categorize: category=${cat} type=${requestType} summary="${classification.summary}"`);
        return this.result('ok', `Categorized: ${cat} (type: ${requestType}).`);
    }
}
