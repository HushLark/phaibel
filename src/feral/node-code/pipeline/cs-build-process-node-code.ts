// ─────────────────────────────────────────────────────────────────────────────
// Cruel Summer Pipeline — Step 5: Build Process
// ─────────────────────────────────────────────────────────────────────────────
//
// The LLM designs a Feral process JSON using the validated nodes and success
// criteria from Steps 3-4.  The process is stored in __cs_process_json for
// cs_execute to run.
//
// Similar to the design phase in pipeline_action_loop but:
//   - Uses __cs_success_statement / __cs_success_checklist in the prompt
//   - Stores the process under __cs_process_json (not the inline run key)
//   - Does not execute — that is the next dedicated step
//
// Reads: user_input, __gathered_context_str, __selected_node_details,
//        __node_code_details, __cs_success_statement, __cs_success_checklist,
//        __reason_model_name, __on_status, __on_process
// Writes: __cs_process_json, __cs_process_reasoning
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
import { EXAMPLE_PROCESSES } from '../../../commands/chat-helpers.js';

export class CSBuildProcessNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK,    description: 'Process designed and stored in __cs_process_json.' },
        { status: ResultStatus.ERROR, description: 'LLM design failed or returned unparseable JSON.' },
    ];

    constructor() {
        super(
            'cs_build_process',
            'CS: Build Process',
            'LLM designs a Feral process JSON from validated nodes and success criteria. Step 5 of Cruel Summer.',
            'pipeline',
        );
    }

    async process(context: Context): Promise<Result> {
        const userInput = context.getString('user_input') ?? '';
        const gatheredStr = context.getString('__gathered_context_str') ?? '';
        const selectedNodeDetails = context.getString('__selected_node_details') ?? '';
        const nodeCodeDetails = context.getString('__node_code_details') ?? '';
        const successStatement = context.getString('__cs_success_statement') ?? '';
        const successChecklist = (context.get('__cs_success_checklist') as string[] | null) ?? [];
        const onStatus = context.get('__on_status') as ((s: string) => void) | null;
        const onProcess = context.get('__on_process') as ((p: Record<string, unknown>) => void) | null;

        onStatus?.('Building process…');

        const examplesStr = EXAMPLE_PROCESSES.map((ex, i) =>
            `Example ${i + 1}: ${ex.description}\n${JSON.stringify(ex.json, null, 2)}`
        ).join('\n\n');

        const successBlock = successStatement
            ? `\nSUCCESS CRITERIA:\n${successStatement}\n${successChecklist.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}\n`
            : '';

        let raw: string;
        try {
            const reasonLlm = await getModelForCapability('reason');
            raw = await reasonLlm.chat(
                [{
                    role: 'user' as const,
                    content: `Build a Feral process to handle: "${userInput}"
${gatheredStr}
${successBlock}
SELECTED CATALOG NODES (use ONLY nodes from this list):
${selectedNodeDetails}

NODE CONFIGURATION DETAILS:
${nodeCodeDetails}

PROCESS FORMAT RULES:
1. schema_version=1, key="cs.generated". First node: key="start", catalog_node_key="start". Last node: key="done", catalog_node_key="stop", edges={}.
2. "edges" maps result statuses to next node key. Most nodes produce "ok" and "error". Use {context_key} for interpolation.
3. Context starts with user_input="${userInput}". Keep processes simple — fewer nodes is better.
4. For entity creation, ALWAYS set entity_title and entity_body with concrete values.
5. create_* nodes ONLY accept: entity_type, entity_title, entity_body, extra_fields. To set field values (startDate, priority, etc.): put values in process "context" object, list field names in extra_fields.
6. DATE FORMAT: date→YYYY-MM-DD, datetime→ISO 8601 with timezone. Events ALWAYS need startDate in context+extra_fields. Include duration in ISO 8601 (e.g. "PT1H", "PT30M"). Default startDate to 09:00 if no time given.
7. CRITICAL: Match entity types precisely. event≠task. Use create_event for appointments/meetings, create_task for todos.
8. When referencing existing entities, use EXACT titles from the gathered context above.
9. Prefer ACTION over QUESTIONS. Use sensible defaults. Max one prompt node per process.
10. If create_content_type is in your node list, you MUST use it first, then create_entity.
11. The process MUST achieve all success criteria listed above.
12. To mark a task done, use complete_task (NOT update_task with status). Valid task status values are: open, in-progress, done, blocked — "complete" and "completed" are invalid enum values.
13. generate_markdown requires input_context_path pointing to an EXISTING context key. The gathered context data is NOT in public context — avoid generate_markdown unless a prior node writes the data to a named public key first.

EXAMPLE PROCESSES:
${examplesStr}

Return a JSON object:
{
  "reasoning": "One sentence explaining the process design",
  "process": { ... the process JSON ... }
}

Return ONLY the JSON object, no markdown fences.`,
                }],
                {
                    systemPrompt: 'Generate a valid Feral process JSON using the provided catalog nodes to achieve the specified success criteria. catalog_node_key values must match exactly.',
                    temperature: 0.3,
                    maxTokens: 16384,
                },
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return this.result(ResultStatus.ERROR, `Process design LLM call failed: ${msg}`);
        }

        let design: { reasoning: string; process: Record<string, unknown> };
        try {
            design = parseJsonResponse(raw) as { reasoning: string; process: Record<string, unknown> };
        } catch (err) {
            return this.result(ResultStatus.ERROR, `Failed to parse process design: ${err instanceof Error ? err.message : err}`);
        }

        context.set('__cs_process_json', design.process);
        context.set('__cs_process_reasoning', design.reasoning);
        onProcess?.(design.process);

        debug('pipeline', `CS build-process: "${design.reasoning}"`);
        return this.result(ResultStatus.OK, `Process designed: "${design.reasoning}"`);
    }
}
