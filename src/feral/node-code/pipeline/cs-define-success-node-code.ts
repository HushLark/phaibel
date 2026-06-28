// ─────────────────────────────────────────────────────────────────────────────
// Cruel Summer Pipeline — Step 3: Define Success
// ─────────────────────────────────────────────────────────────────────────────
//
// Before building or executing anything, the LLM defines concrete, verifiable
// success criteria for this specific request.  These criteria are used by
// cs_evaluate_success (Step 7) to decide if the pipeline should loop back.
//
// Reads: user_input, __cs_category, __cs_request_type, __cs_output_spec,
//        __gathered_context_str, __on_status
// Writes: __cs_success_statement, __cs_success_checklist
// Result: ok | error
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { getModelForCapability } from '../../../llm/router.js';
import { parseJsonResponse } from '../../../utils/json-parser.js';
import { debug } from '../../../utils/debug.js';

export class CSDefineSuccessNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK,    description: 'Success criteria defined and stored.' },
        { status: ResultStatus.ERROR, description: 'LLM call failed.' },
    ];

    constructor() {
        super(
            'cs_define_success',
            'CS: Define Success',
            'Generates concrete, verifiable success criteria for the request before any process is built. Step 3 of Cruel Summer.',
            'pipeline',
        );
    }

    async process(context: Context): Promise<Result> {
        const userInput = context.getString('user_input') ?? '';
        const category = context.getString('__cs_category') ?? 'action';
        const requestType = context.getString('__cs_request_type') ?? 'action';
        const outputSpec = context.getString('__cs_output_spec') ?? '';
        const gatheredStr = context.getString('__gathered_context_str') ?? '';
        const onStatus = context.get('__on_status') as ((s: string) => void) | null;
        const retryCount = (context.get('__cs_retry_count') as number | null) ?? 0;

        onStatus?.('Defining success criteria…');

        const previousFailureNote = retryCount > 0
            ? `\nNOTE: A previous attempt failed. This is retry ${retryCount}. Focus criteria purely on DATA STATE (entity created/updated/found) — do not add output or formatting requirements.\n`
            : '';

        let raw: string;
        try {
            const categorizeLlm = await getModelForCapability('categorize');
            raw = await categorizeLlm.chat(
                [{
                    role: 'user' as const,
                    content: `${previousFailureNote}Define precise, verifiable success criteria for this request.

USER REQUEST: "${userInput}"
CATEGORY: ${category} | TYPE: ${requestType}
EXPECTED OUTPUT: ${outputSpec}

AVAILABLE CONTEXT:
${gatheredStr || '(no entities gathered)'}

What data state changes must be TRUE for this request to be considered handled?
Focus ONLY on entity mutations and data state — not presentation.

GOOD criteria (data state):
- "Task entity created with status=open and title='X'"
- "Person entity field lastName updated to 'Torres'"
- "Event entity found with startDate set to 2026-06-24"

BAD criteria (presentation — do NOT include these):
- "A confirmation message is returned to the user"
- "The output contains formatted sections"
- "response_message or output_markdown field is populated"

The process that runs handles data; a separate synthesis step handles presentation. Do not require formatted output, confirmation messages, or user-facing text in your criteria.

Return JSON only:
{
  "success_statement": "One sentence describing the required data state change",
  "success_checklist": [
    "Verifiable data-state condition 1",
    "Verifiable data-state condition 2"
  ]
}`,
                }],
                {
                    systemPrompt: 'You define success criteria for an AI personal assistant completing a task. Criteria must describe DATA STATE only — entity fields created or updated. Never require confirmation messages, formatted output, or user-facing text; a separate synthesis step handles presentation.',
                    temperature: 0.2,
                },
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // Fallback: derive success from output spec
            context.set('__cs_success_statement', outputSpec || `The user's request "${userInput}" was fulfilled.`);
            context.set('__cs_success_checklist', [outputSpec || userInput]);
            debug('pipeline', `CS define-success fallback: ${msg}`);
            return this.result(ResultStatus.OK, 'Success criteria set from output spec (LLM unavailable).');
        }

        try {
            const parsed = parseJsonResponse(raw) as {
                success_statement: string;
                success_checklist: string[];
            };

            context.set('__cs_success_statement', parsed.success_statement);
            context.set('__cs_success_checklist', parsed.success_checklist ?? [parsed.success_statement]);

            debug('pipeline', `CS define-success: "${parsed.success_statement}" (${(parsed.success_checklist ?? []).length} criteria)`);
            return this.result(ResultStatus.OK, `Success criteria defined: "${parsed.success_statement}"`);
        } catch (err) {
            context.set('__cs_success_statement', outputSpec || userInput);
            context.set('__cs_success_checklist', [outputSpec || userInput]);
            debug('pipeline', `CS define-success parse failed: ${err}`);
            return this.result(ResultStatus.OK, 'Success criteria set from output spec (parse failed).');
        }
    }
}
