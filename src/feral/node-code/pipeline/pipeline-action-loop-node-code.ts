// ─────────────────────────────────────────────────────────────────────────────
// Pipeline NodeCode — Action Loop (Phases 5-7)
// ─────────────────────────────────────────────────────────────────────────────
//
// The core LLM-driven action loop:
//   Phase 5 — Design: reason LLM generates a Feral process JSON
//   Phase 6 — Execute: hydrate + run the generated process inline
//   Phase 7 — Check: categorize LLM decides if the request is complete
// Repeats up to MAX_ITERATIONS times.
//
// The generated process is executed via engine.process() directly (no factory
// registration needed), sharing the pipeline's context so entity nodes can
// read/write the same vault state.
//
// Reads: user_input, __history, __gathered_context_str, __selected_node_details,
//        __node_code_details, __on_status, __on_process, __process_engine,
//        __reason_model_name
// Writes: __all_results, __all_reasonings, __nodes_used, __process_source,
//         __process_key
// Result: ok | error
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import type { ProcessEngine } from '../../engine/process-engine.js';
import type { CatalogNode } from '../../catalog/catalog-node.js';
import { hydrateProcess } from '../../process/process-json-hydrator.js';
import { getModelForCapability } from '../../../llm/router.js';
import { parseJsonResponse } from '../../../utils/json-parser.js';
import { debug } from '../../../utils/debug.js';
import {
    EXAMPLE_PROCESSES,
    formatHistoryBlock,
    compactResultsForPrompt,
    scrubSecrets,
} from '../../../commands/chat-helpers.js';
import type { ChatHistoryEntry } from '../../../commands/chat-helpers.js';

const MAX_ITERATIONS = 3;

export class PipelineActionLoopNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK,    description: 'Action loop completed; results in __all_results.' },
        { status: ResultStatus.ERROR, description: 'Process design or execution failed on all iterations.' },
    ];

    constructor() {
        super(
            'pipeline_action_loop',
            'Pipeline: Action Loop',
            'LLM-driven design → execute → check loop (Phases 5-7). Generates and runs Feral processes inline up to 3 times.',
            'pipeline',
        );
    }

    async process(context: Context): Promise<Result> {
        const userInput = context.getString('user_input') ?? '';
        const history = (context.get('__history') as ChatHistoryEntry[] | null) ?? [];
        const onStatus = context.get('__on_status') as ((s: string) => void) | null;
        const onProcess = context.get('__on_process') as ((p: Record<string, unknown>) => void) | null;
        const engine = context.get('__process_engine') as ProcessEngine | null;
        const reasonModelName = (context.getString('__reason_model_name') ?? 'gpt-4o');

        const selectedNodeDetails = context.getString('__selected_node_details') ?? '';
        const nodeCodeDetails = context.getString('__node_code_details') ?? '';
        const gatheredContextStr = context.getString('__gathered_context_str') ?? '';
        const selectedNodes = (context.get('__selected_nodes') as CatalogNode[] | null) ?? [];

        if (!engine) {
            return this.result(ResultStatus.ERROR, 'pipeline_action_loop requires __process_engine in context.');
        }

        context.set('__process_source', 'custom');
        context.set('__process_key', 'chat.generated');

        const examplesStr = EXAMPLE_PROCESSES.map((ex, i) =>
            `Example ${i + 1}: ${ex.description}\n${JSON.stringify(ex.json, null, 2)}`
        ).join('\n\n');
        const historyBlock = formatHistoryBlock(history);

        const allResults: Record<string, unknown>[] = [];
        const allReasonings: string[] = [];
        const seenFingerprints = new Set<string>();
        let remainingWork = userInput;

        for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
            // ── Phase 5: Design ─────────────────────────────────────────────
            onStatus?.(`Designing process${iteration > 0 ? ` (step ${iteration + 1})` : ''}…`);

            const previousResultsStr = allResults.length > 0
                ? `\n\nRESULTS FROM PREVIOUS STEPS:\n${compactResultsForPrompt(allResults, reasonModelName)}`
                : '';

            let phase5Response: string;
            try {
                const reasonLlm = await getModelForCapability('reason');
                phase5Response = await reasonLlm.chat(
                    [{
                        role: 'user' as const,
                        content: `Build a Feral process to handle: "${remainingWork}"
${historyBlock}${previousResultsStr}
${gatheredContextStr}

SELECTED CATALOG NODES (you must only use nodes from this list):
${selectedNodeDetails}

NODE CONFIGURATION DETAILS:
${nodeCodeDetails}

PROCESS FORMAT RULES:
1. schema_version=1, key="chat.generated". First node: key="start", catalog_node_key="start". Last node: key="done", catalog_node_key="stop", edges={}.
2. "edges" maps result statuses to next node key. Most nodes produce "ok" and "error". Use {context_key} for interpolation.
3. Context starts with user_input="${userInput}". Keep processes simple — fewer nodes is better.
4. For entity creation, ALWAYS set entity_title and entity_body with concrete values.
5. create_* nodes ONLY accept: entity_type, entity_title, entity_body, extra_fields. To set fields (startDate, priority, etc.): put values in process "context" object, list field names in extra_fields. For multi-entity with different field values, use set_context_value nodes between creates.
6. DATE FORMAT: date→YYYY-MM-DD, datetime→ISO 8601 with timezone (e.g. "2026-03-25T14:00:00-06:00"). Events ALWAYS need startDate in context+extra_fields. Include duration in ISO 8601 format (e.g. "PT1H" not "1h", "PT30M" not "30m") or endDate if known. Default startDate to 09:00 if no time given.
7. CRITICAL: Match entity types precisely. event≠task. Use create_event for appointments/meetings, create_task for todos. Never substitute types.
8. When referencing existing entities, use EXACT titles from GATHERED CONTEXT. Use valid enum values only.
9. Prefer ACTION over QUESTIONS. Use sensible defaults (today's date, "medium" priority). Max one prompt node per process.
10. If create_content_type is in your node list, you MUST use it. Create type FIRST, then create_entity. Don't use "note" as a generic bucket.
11. Multiple create_entity nodes of same type work correctly — don't worry about context key collisions.
12. For search_* nodes, set "query" in config.

EXAMPLE PROCESSES:
${examplesStr}

Return a JSON object with this exact structure:
{
    "reasoning": "One short sentence",
    "process": { ... the process JSON ... }
}

IMPORTANT: Keep "reasoning" to ONE sentence. The process JSON is what matters.

Return ONLY the JSON object, no markdown fences.`,
                    }],
                    {
                        systemPrompt: 'Generate a valid Feral process JSON using provided catalog nodes. catalog_node_key values must match exactly. Prefer action over advice.',
                        temperature: 0.3,
                        maxTokens: 16384,
                    },
                );
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (allReasonings.length === 0) {
                    return this.result(ResultStatus.ERROR, `Process design failed: ${msg}`);
                }
                break; // Have some results already — proceed to synthesis
            }

            let processDesign: { reasoning: string; process: Record<string, unknown> };
            try {
                processDesign = parseJsonResponse(phase5Response) as { reasoning: string; process: Record<string, unknown> };
            } catch (err) {
                if (allReasonings.length === 0) {
                    return this.result(ResultStatus.ERROR, `Failed to parse process design: ${err instanceof Error ? err.message : err}`);
                }
                break;
            }

            const fingerprint = JSON.stringify(processDesign.process);
            if (seenFingerprints.has(fingerprint)) {
                debug('pipeline', `Duplicate process at iteration ${iteration + 1} — breaking`);
                break;
            }
            seenFingerprints.add(fingerprint);

            allReasonings.push(processDesign.reasoning);
            onProcess?.(processDesign.process);

            // ── Phase 6: Execute ─────────────────────────────────────────────
            onStatus?.(`Running process${iteration > 0 ? ` (step ${iteration + 1})` : ''}…`);

            let processJsonStr: string;
            try {
                processJsonStr = JSON.stringify(processDesign.process);
            } catch {
                if (allReasonings.length <= 1) return this.result(ResultStatus.ERROR, 'Generated process is not serialisable JSON.');
                break;
            }

            // Snapshot non-internal keys before running
            const beforeKeys = new Set(Object.keys(context.getAll()).filter(
                k => !k.startsWith('_') && !k.startsWith('__') && k !== 'user_input',
            ));

            try {
                const inlineProcess = hydrateProcess(JSON.parse(processJsonStr));
                engine.clearCache();
                await engine.process(inlineProcess, context);
                engine.clearCache();
            } catch (execErr) {
                debug('pipeline', `Process execution failed: ${execErr instanceof Error ? execErr.stack ?? execErr.message : execErr}`);
                engine.clearCache();
                const errorResult: Record<string, unknown> = {
                    _error: execErr instanceof Error ? execErr.message : String(execErr),
                };
                allResults.push(scrubSecrets(errorResult) as Record<string, unknown>);
            }

            // Collect results: all non-internal context keys (new + changed)
            const afterCtx = context.getAll();
            const iterationResult: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(afterCtx)) {
                if (k.startsWith('_') || k.startsWith('__') || k === 'user_input') continue;
                iterationResult[k] = typeof v === 'string' && v.length > 2000 ? v.slice(0, 2000) + '…' : v;
            }
            allResults.push(scrubSecrets(iterationResult) as Record<string, unknown>);
            void beforeKeys; // kept for potential future diff-based extraction

            // ── Phase 7: Completion check ────────────────────────────────────
            if (iteration < MAX_ITERATIONS - 1) {
                onStatus?.('Checking if task is complete…');
                try {
                    const categorizeLlm = await getModelForCapability('categorize');
                    const completionResponse = await categorizeLlm.chat(
                        [{
                            role: 'user' as const,
                            content: `The user originally said: "${userInput}"

We have completed ${iteration + 1} step(s) so far.

Step reasoning: ${allReasonings.join(' → ')}

Results from all steps:
${compactResultsForPrompt(allResults, reasonModelName)}

Is the user's request fulfilled? Consider:
- Did we create the entity/entities the user explicitly asked for?
- If the user asked for multiple DISTINCT actions (e.g., "create a task AND a note"), were all done?

IMPORTANT rules for deciding:
- Check the "created_entities" array in the results — it accumulates ALL entities created across all nodes in the process, even when individual context keys get overwritten.
- Check the "created_entity_types" array — it shows all new types that were registered.
- If an entity was successfully created, the request is COMPLETE — do NOT retry because of minor details like metadata formatting.
- Do NOT request "more work" for implementation details (e.g., how a blackout window is stored, or whether a field was set in exactly the right way).
- If the request itself STATES a relationship (a business and its locations/headquarters/served places, a person and their employer), the graph edges ARE the work: request "more work" when an endpoint entity or its link is missing from the results. For links the user did not imply, do NOT request more work — incidental linking is nice-to-have.
- Only say "more_work" if a user-requested entity or action is clearly MISSING from the results.
- When in doubt, say COMPLETE. Creating duplicates is worse than a slightly imperfect result.

Return a JSON object with EXACTLY this structure:
If COMPLETE: { "status": "complete" }
If MORE WORK NEEDED: { "status": "more_work", "remaining": "Description of what still needs to be done" }

Return ONLY the JSON object, no markdown fences.`,
                        }],
                        {
                            systemPrompt: 'You are a task completion checker for Phaibel, a Personal Digital Agent. Only say "more_work" when the user explicitly asked for multiple distinct things and one is clearly missing from the results. Do NOT nitpick implementation details or request re-creation of entities that already exist. Creating duplicates is a serious problem — err on the side of saying "complete".',
                            temperature: 0.2,
                        },
                    );

                    const completion = parseJsonResponse(completionResponse) as { status: string; remaining?: string };
                    if (completion.status === 'complete') {
                        debug('pipeline', 'Task complete — exiting action loop');
                        break;
                    }
                    remainingWork = completion.remaining || userInput;
                    debug('pipeline', `More work needed: ${remainingWork}`);
                } catch {
                    debug('pipeline', 'Completion check failed — assuming complete');
                    break;
                }
            }
        }

        // Store accumulated results for synthesis
        const nodesUsed = selectedNodes
            .filter(Boolean)
            .map(n => `- ${n!.key}: ${n!.description || n!.name}`);

        context.set('__all_results', allResults);
        context.set('__all_reasonings', allReasonings);
        context.set('__nodes_used', nodesUsed);

        return this.result(ResultStatus.OK, `Action loop complete (${allReasonings.length} iteration(s)).`);
    }
}
