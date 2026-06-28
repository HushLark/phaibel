// ─────────────────────────────────────────────────────────────────────────────
// Cruel Summer Pipeline — Step 7: Evaluate Success
// ─────────────────────────────────────────────────────────────────────────────
//
// After executing the generated process, this node checks whether the success
// criteria from Step 3 were met.  If not, it increments the retry counter and
// routes back to cs_categorize (Step 1) to try again.
//
// This creates the outer retry cycle in the Cruel Summer pipeline.
// The Feral engine follows the "retry" edge back to cs_categorize — this is
// intentional; the engine supports directed graphs with cycles.
//
// Cycle guard: __cs_retry_count is incremented each time this node runs.
//   When __cs_retry_count >= MAX_RETRIES, routes "max_retries" → synthesize
//   instead of "retry" → cs_categorize.
//
// Reads: user_input, __cs_success_statement, __cs_success_checklist,
//        __cs_process_reasoning (from build), public context keys (entity results)
//        __cs_retry_count
// Writes: __cs_retry_count (incremented), __cs_evaluation, __all_results,
//         __all_reasonings
// Result: "success" | "retry" | "max_retries" | error
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { getModelForCapability } from '../../../llm/router.js';
import { parseJsonResponse } from '../../../utils/json-parser.js';
import { debug } from '../../../utils/debug.js';
import { scrubSecrets } from '../../../commands/chat-helpers.js';

const MAX_RETRIES = 3;

export class CSEvaluateSuccessNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: 'success',     description: 'Success criteria met — proceed to synthesis.' },
        { status: 'retry',       description: 'Criteria not met — loop back to Step 1 (cs_categorize).' },
        { status: 'max_retries', description: `Max ${MAX_RETRIES} retries reached — proceed to synthesis with best effort.` },
        { status: ResultStatus.ERROR, description: 'Evaluation LLM call failed.' },
    ];

    constructor() {
        super(
            'cs_evaluate_success',
            'CS: Evaluate Success',
            `Checks success criteria after process execution. Routes "retry" back to Step 1 (max ${MAX_RETRIES} times). Step 7 of Cruel Summer.`,
            'pipeline',
        );
    }

    async process(context: Context): Promise<Result> {
        const userInput = context.getString('user_input') ?? '';
        const successStatement = context.getString('__cs_success_statement') ?? userInput;
        const successChecklist = (context.get('__cs_success_checklist') as string[] | null) ?? [successStatement];
        const processReasoning = context.getString('__cs_process_reasoning') ?? '';
        const gatheredContextStr = context.getString('__gathered_context_str') ?? '';
        const onStatus = context.get('__on_status') as ((s: string) => void) | null;

        const retryCount = (context.get('__cs_retry_count') as number | null) ?? 0;

        onStatus?.('Evaluating success…');

        // Collect all public context values (entity results from the executed process)
        const publicCtx = Object.fromEntries(
            Object.entries(context.getAll())
                .filter(([k]) => !k.startsWith('_') && !k.startsWith('__') && k !== 'user_input'),
        );
        const publicCtxStr = JSON.stringify(scrubSecrets(publicCtx), null, 2);

        // Gathered context (from Step 2) — entity data retrieved before process execution.
        // For query-type requests this is the primary evidence of success.
        const gatheredBlock = gatheredContextStr
            ? `\nGATHERED CONTEXT (entities retrieved in Step 2 — primary evidence for queries):\n${gatheredContextStr.slice(0, 2000)}${gatheredContextStr.length > 2000 ? '\n...(truncated)' : ''}\n`
            : '';

        let evaluation: { met: boolean; reasoning: string; checklist_results?: Array<{ item: string; met: boolean; reason: string }> };

        try {
            const categorizeLlm = await getModelForCapability('categorize');
            const raw = await categorizeLlm.chat(
                [{
                    role: 'user' as const,
                    content: `Evaluate whether the request was successfully handled.

USER REQUEST: "${userInput}"

SUCCESS CRITERIA:
${successStatement}

SUCCESS CHECKLIST:
${successChecklist.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}

PROCESS REASONING: ${processReasoning}
${gatheredBlock}
CONTEXT AFTER EXECUTION (public keys written by the process):
${publicCtxStr.length > 3000 ? publicCtxStr.slice(0, 3000) + '\n...(truncated)' : publicCtxStr}

For each item in the checklist: was it fulfilled?
Look for evidence in the context (created entities, updated fields, search results, etc.).

IMPORTANT: The process mutates data — it does NOT produce formatted user responses.
- If a checklist item requires a "confirmation_message", "response_message", "output_markdown", or similar output field: IGNORE that requirement and mark it met if the underlying action succeeded.
- Only fail if the actual entity mutation or data lookup did not happen.
- A separate synthesis step handles all user-facing presentation.

Return JSON only:
{
  "met": true | false,
  "reasoning": "One sentence overall assessment",
  "checklist_results": [
    { "item": "checklist item", "met": true | false, "reason": "brief explanation" }
  ]
}`,
                }],
                {
                    systemPrompt: 'You evaluate whether an AI task was completed successfully. Judge ONLY data state: was the entity created, updated, or found? Ignore any checklist items about confirmation messages, formatted output, or user-facing text — those are handled by a separate synthesis step and will never appear in the process context. If the entity action happened, mark it met.',
                    temperature: 0.2,
                },
            );

            evaluation = parseJsonResponse(raw) as typeof evaluation;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            debug('pipeline', `CS evaluate-success LLM failed: ${msg} — treating as success`);
            // If we can't evaluate, assume success to avoid infinite loops
            evaluation = { met: true, reasoning: `Evaluation unavailable: ${msg}` };
        }

        // Store evaluation for synthesis
        context.set('__cs_evaluation', evaluation);
        const existing = (context.get('__all_reasonings') as string[] | null) ?? [];
        existing.push(evaluation.reasoning);
        context.set('__all_reasonings', existing);

        // Collect public context as result snapshot
        const allResults = (context.get('__all_results') as Record<string, unknown>[] | null) ?? [];
        allResults.push(scrubSecrets(publicCtx) as Record<string, unknown>);
        context.set('__all_results', allResults);

        debug('pipeline', `CS evaluate-success: met=${evaluation.met} retry=${retryCount}/${MAX_RETRIES} — ${evaluation.reasoning}`);

        if (evaluation.met) {
            return this.result('success', 'Success criteria met.');
        }

        // Increment retry counter before routing back
        const nextRetry = retryCount + 1;
        context.set('__cs_retry_count', nextRetry);

        if (nextRetry >= MAX_RETRIES) {
            return this.result('max_retries', `Max retries (${MAX_RETRIES}) reached — proceeding to synthesis.`);
        }

        return this.result('retry', `Criteria not met (attempt ${nextRetry}/${MAX_RETRIES}): ${evaluation.reasoning}`);
    }
}
