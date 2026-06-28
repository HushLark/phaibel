// ─────────────────────────────────────────────────────────────────────────────
// Cruel Summer Pipeline — Step 1: Categorize
// ─────────────────────────────────────────────────────────────────────────────
//
// Structured intent extraction.  Rather than simple routing, this step
// produces three artefacts that guide every downstream step:
//
//   context_search_params — what to look for in the vault
//   output_spec           — what the final output must contain
//   request_type          — action / query / analytical / conversational
//
// Safety and chat fast-path are still handled here to avoid running the
// full 8-step loop on greetings or blocked requests.
//
// Reads: user_input, __history, __cs_retry_count (tracks outer retries),
//        __on_status
// Writes: __classification, __cs_category, __cs_context_search_params,
//         __cs_output_spec, __cs_request_type
// Result: "chat" (→ synthesize), "blocked" (→ stop), "ok" (→ context_loop),
//         "error"
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { classifyRequest, BLOCKED_RESPONSE } from '../../../context/request-classifier.js';
import { inferWeights } from '../../../context/request-weights.js';
import { getModelForCapability } from '../../../llm/router.js';
import { parseJsonResponse } from '../../../utils/json-parser.js';
import { debug } from '../../../utils/debug.js';
import { formatHistoryBlock } from '../../../commands/chat-helpers.js';
import type { ChatHistoryEntry } from '../../../commands/chat-helpers.js';

export class CSCategorizeNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: 'ok',      description: 'Categorized — proceed to context loop.' },
        { status: 'chat',    description: 'Phatic exchange — route directly to synthesis.' },
        { status: 'blocked', description: 'Guardrail triggered — stop processing.' },
        { status: ResultStatus.ERROR, description: 'Categorization failed.' },
    ];

    constructor() {
        super(
            'cs_categorize',
            'CS: Categorize Request',
            'Extracts structured intent: context search params, output spec, and request type. Step 1 of Cruel Summer.',
            'pipeline',
        );
    }

    async process(context: Context): Promise<Result> {
        const userInput = context.getString('user_input') ?? '';
        const history = (context.get('__history') as ChatHistoryEntry[] | null) ?? [];
        const onStatus = context.get('__on_status') as ((s: string) => void) | null;
        const retryCount = (context.get('__cs_retry_count') as number | null) ?? 0;

        onStatus?.(retryCount > 0 ? `Re-categorizing (attempt ${retryCount + 1})…` : 'Analyzing request…');

        // ── Safety + basic classification ─────────────────────────────────────
        let classification;
        try {
            const categorizeLlm = await getModelForCapability('categorize');
            classification = await classifyRequest(categorizeLlm, userInput, history);
        } catch (err) {
            return this.result(ResultStatus.ERROR, `Classification failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        if (classification.blocked) {
            context.set('__pipeline_response', BLOCKED_RESPONSE);
            return this.result('blocked', 'Request blocked.');
        }
        if (classification.category === 'chat') {
            return this.result('chat', 'Phatic exchange — skipping full pipeline.');
        }

        context.set('__classification', classification);
        context.set('__request_weights', inferWeights(classification));

        // ── Structured intent extraction ──────────────────────────────────────
        const historyBlock = formatHistoryBlock(history);
        const previousAttemptNote = retryCount > 0
            ? `\nNOTE: This is retry attempt ${retryCount}. The previous attempt did not fully meet success criteria — be more precise about what context and output is needed.\n`
            : '';

        const categorizeLlm = await getModelForCapability('categorize');
        const raw = await categorizeLlm.chat(
            [{
                role: 'user' as const,
                content: `${previousAttemptNote}Analyse this request and produce a structured plan for handling it.

USER REQUEST: "${userInput}"
${historyBlock}
CLASSIFICATION: category="${classification.category}", summary="${classification.summary}"

Produce:
1. context_search_params — what entities, topics, or data to look up in the user's vault
   (be specific: names, types, date ranges, keywords)
2. output_spec — a precise description of what the final response must contain
   (e.g. "A list of open tasks with due dates", "A new goal entity named X with priority high")
3. request_type — one of: action | query | analytical | conversational | creative

Return JSON only:
{
  "context_search_params": ["search term or entity type 1", "search term 2"],
  "output_spec": "Precise description of desired output",
  "request_type": "action|query|analytical|conversational|creative",
  "reasoning": "Brief explanation"
}`,
            }],
            { systemPrompt: 'You are a precise intent analyst for a personal AI assistant. Extract exactly what context is needed and what the output must contain.', temperature: 0.2 },
        );

        try {
            const parsed = parseJsonResponse(raw) as {
                context_search_params: string[];
                output_spec: string;
                request_type: string;
                reasoning: string;
            };

            context.set('__cs_category', classification.category);
            context.set('__cs_context_search_params', parsed.context_search_params ?? [classification.summary]);
            context.set('__cs_output_spec', parsed.output_spec ?? classification.summary);
            context.set('__cs_request_type', parsed.request_type ?? 'action');

            debug('pipeline', `CS categorize: type=${parsed.request_type} search_params=[${(parsed.context_search_params ?? []).join(', ')}]`);
            return this.result('ok', `Categorized as "${parsed.request_type}".`);
        } catch (err) {
            // Fall back to classification summary if structured extraction fails
            context.set('__cs_category', classification.category);
            context.set('__cs_context_search_params', [classification.summary]);
            context.set('__cs_output_spec', classification.summary);
            context.set('__cs_request_type', 'action');
            debug('pipeline', `CS categorize fallback: ${err}`);
            return this.result('ok', 'Categorized (fallback to classification summary).');
        }
    }
}
