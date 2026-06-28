// ─────────────────────────────────────────────────────────────────────────────
// Hertz Pipeline — Step 4: Evaluate
// ─────────────────────────────────────────────────────────────────────────────
//
// After the execute loop, checks whether the success criteria from hz_plan
// were met.  On failure, increments the retry counter and routes back to
// hz_plan — which will see the evaluation failure note and produce a revised
// plan.  This creates the chain-of-thought retry cycle:
//
//   hz_plan → hz_execute → hz_evaluate → hz_plan (on retry)
//
// Max MAX_RETRIES outer retries.  Also publishes __all_results and
// __all_reasonings for the synthesis step.
//
// Reads: user_input, __hz_success_criteria, __hz_success_checklist,
//        __hz_action_log, __hz_gathered_context_str, __hz_retry_count
// Writes: __hz_evaluation_reasoning, __hz_retry_count (incremented on retry),
//         __all_results, __all_reasonings
// Result: "success" | "retry" (→ hz_plan) | "max_retries" | error
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
import type { GatheredContext } from '../../../context/context-loop.js';
import type { IndexNode } from '../../../entities/entity-index.js';

const MAX_RETRIES = 2;

export class HZEvaluateNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: 'success',          description: 'Success criteria met — proceed to synthesis.' },
        { status: 'retry',            description: `Criteria not met — route to hz_plan for revised plan.` },
        { status: 'max_retries',      description: `Max ${MAX_RETRIES} retries reached — proceed to synthesis.` },
        { status: ResultStatus.ERROR, description: 'Evaluation LLM failed.' },
    ];

    constructor() {
        super(
            'hz_evaluate',
            'Hz: Evaluate',
            `Checks success criteria after execution. Routes "retry" → hz_plan for replanning (max ${MAX_RETRIES} times). Step 4 of Hertz.`,
            'pipeline',
        );
    }

    async process(context: Context): Promise<Result> {
        const userInput = context.getString('user_input') ?? '';
        const successCriteria = context.getString('__hz_success_criteria') ?? userInput;
        const successChecklist = (context.get('__hz_success_checklist') as string[] | null) ?? [successCriteria];
        const actionLog = (context.get('__hz_action_log') as string[] | null) ?? [];
        const gatheredStr = context.getString('__hz_gathered_context_str') ?? '';
        const gatheredCtx = context.get('__hz_gathered_context') as GatheredContext | null;
        const retryCount = (context.get('__hz_retry_count') as number | null) ?? 0;
        const onStatus = context.get('__on_status') as ((s: string) => void) | null;

        onStatus?.('Reviewing results…');

        // Public context — entity mutations written by the executed process
        const publicCtx = Object.fromEntries(
            Object.entries(context.getAll())
                .filter(([k]) => !k.startsWith('_') && k !== 'user_input'),
        );
        const publicCtxStr = JSON.stringify(scrubSecrets(publicCtx), null, 2);

        // Entity manifest — computed from the full nodes array so truncation of gatheredStr
        // doesn't cause evaluate to falsely report an entity as missing.
        const entityManifest = gatheredCtx && gatheredCtx.nodes.length > 0
            ? `ENTITIES IN GATHERED CONTEXT (${gatheredCtx.nodes.length} total):\n` +
              gatheredCtx.nodes.map((n: IndexNode) => `  [${n.type}:${n.id}] ${n.name}`).join('\n')
            : 'ENTITIES IN GATHERED CONTEXT: (none)';

        const gatheredBlock = gatheredStr
            ? `\n${entityManifest}\n\nGATHERED CONTEXT DETAILS:\n${gatheredStr.slice(0, 3000)}${gatheredStr.length > 3000 ? '\n...(truncated)' : ''}\n`
            : `\n${entityManifest}\n`;

        let evaluation: {
            met: boolean;
            reasoning: string;
            checklist_results?: Array<{ item: string; met: boolean; reason: string }>;
        };

        try {
            const categorizeLlm = await getModelForCapability('categorize');
            const raw = await categorizeLlm.chat(
                [{
                    role: 'user' as const,
                    content: `Evaluate whether this request was successfully handled.

USER REQUEST: "${userInput}"

SUCCESS CRITERIA:
${successCriteria}

SUCCESS CHECKLIST:
${successChecklist.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}

ACTION LOG (what was done):
${actionLog.map((l, i) => `  ${i + 1}. ${l}`).join('\n') || '  (no actions taken)'}
${gatheredBlock}
CONTEXT AFTER EXECUTION (entity mutations, public keys):
${publicCtxStr.length > 3000 ? publicCtxStr.slice(0, 3000) + '\n...(truncated)' : publicCtxStr}

For each checklist item: was it fulfilled?
Evidence: GATHERED CONTEXT for queries, CONTEXT AFTER EXECUTION for mutations.

IMPORTANT — judge DATA STATE only:
- Was an entity created, updated, or found? → that counts.
- Ignore any checklist items about confirmation messages, formatted output, or user-facing text.
- If gathered context contains the requested entities, query items are met.

Return JSON:
{
  "met": true | false,
  "reasoning": "One sentence overall assessment",
  "checklist_results": [
    { "item": "...", "met": true | false, "reason": "brief" }
  ]
}`,
                }],
                {
                    systemPrompt: 'Evaluate whether an AI task completed successfully. Judge ONLY data state: was the entity created, updated, or found? Ignore requirements about confirmation messages or formatted output — those are handled by a separate synthesis step.',
                    temperature: 0.2,
                },
            );
            evaluation = parseJsonResponse(raw) as typeof evaluation;
        } catch (err) {
            debug('pipeline', `Hz evaluate: LLM failed — treating as success: ${err}`);
            evaluation = { met: true, reasoning: `Evaluation unavailable: ${err instanceof Error ? err.message : String(err)}` };
        }

        // Store failure reasoning for hz_plan retry replanning
        context.set('__hz_evaluation_reasoning', evaluation.reasoning);

        // Publish accumulated results for synthesis
        const existingReasonings = (context.get('__all_reasonings') as string[] | null) ?? [];
        existingReasonings.push(evaluation.reasoning);
        context.set('__all_reasonings', existingReasonings);

        const allResults = (context.get('__all_results') as Record<string, unknown>[] | null) ?? [];
        allResults.push(scrubSecrets(publicCtx) as Record<string, unknown>);
        context.set('__all_results', allResults);

        debug('pipeline', `Hz evaluate: met=${evaluation.met} retry=${retryCount}/${MAX_RETRIES} — ${evaluation.reasoning}`);

        if (evaluation.met) {
            return this.result('success', 'Success criteria met.');
        }

        const nextRetry = retryCount + 1;
        context.set('__hz_retry_count', nextRetry);

        if (nextRetry >= MAX_RETRIES) {
            return this.result('max_retries', `Max retries (${MAX_RETRIES}) reached — proceeding to synthesis.`);
        }

        return this.result('retry', `Criteria not met (attempt ${nextRetry}/${MAX_RETRIES}): ${evaluation.reasoning}`);
    }
}
