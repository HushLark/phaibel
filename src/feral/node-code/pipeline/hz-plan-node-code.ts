// ─────────────────────────────────────────────────────────────────────────────
// Hertz Pipeline — Step 2: Plan
// ─────────────────────────────────────────────────────────────────────────────
//
// Chain-of-thought planning step.  Does a quick initial context fetch, then
// asks the LLM to produce an explicit execution plan with success criteria.
// On retry (from hz_evaluate), skips context fetch and replans from the
// evaluation failure note.
//
// Plan steps drive the execute loop:
//   query_context   — search vault for entities
//   query_catalog   — find and select catalog nodes
//   build_process   — design a Feral process JSON
//   execute_process — run the designed process
//
// Reads: user_input, __hz_category, __hz_intent_summary, __hz_request_type,
//        __classification, __request_weights, __entity_index, __entity_types,
//        __hz_retry_count, __hz_evaluation_reasoning
// Writes: __hz_plan_steps, __hz_plan_reasoning, __hz_success_criteria,
//         __hz_success_checklist, __hz_gathered_context, __hz_gathered_context_str
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
import { fetchContextByClassification, serializeGatheredContext } from '../../../context/context-loop.js';
import type { GatheredContext } from '../../../context/context-loop.js';
import type { ClassificationResult } from '../../../context/request-classifier.js';
import type { RequestWeights } from '../../../context/request-weights.js';
import type { EntityIndex } from '../../../entities/entity-index.js';
import type { EntityTypeConfig } from '../../../entities/entity-type-config.js';

export interface HertzPlanStep {
    type: 'query_context' | 'query_catalog' | 'build_process' | 'execute_process';
    description: string;
    hint?: string;
}

export class HZPlanNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK,    description: 'Plan generated — proceed to execution.' },
        { status: ResultStatus.ERROR, description: 'Plan generation failed — default plan in use.' },
    ];

    constructor() {
        super(
            'hz_plan',
            'Hz: Plan',
            'Chain-of-thought planning: initial context fetch + LLM-generated execution plan with success criteria. Step 2 of Hertz.',
            'pipeline',
        );
    }

    async process(context: Context): Promise<Result> {
        const userInput = context.getString('user_input') ?? '';
        const category = context.getString('__hz_category') ?? 'action';
        const requestType = context.getString('__hz_request_type') ?? 'action';
        const intentSummary = context.getString('__hz_intent_summary') ?? userInput;
        const retryCount = (context.get('__hz_retry_count') as number | null) ?? 0;
        const onStatus = context.get('__on_status') as ((s: string) => void) | null;

        const classification = context.get('__classification') as ClassificationResult | null;
        const requestWeights = context.get('__request_weights') as RequestWeights | null;
        const entityIndex = context.get('__entity_index') as EntityIndex | null;
        const entityTypes = (context.get('__entity_types') as EntityTypeConfig[] | null) ?? [];

        onStatus?.('Planning approach…');

        // ── Initial context fetch (first run only) ────────────────────────────
        // On retry, hz_execute already accumulated context — reuse it to avoid
        // duplicate fetches and potential confusion with fresh data.
        let gatheredStr = context.getString('__hz_gathered_context_str') ?? '';
        if (retryCount === 0 && entityIndex && classification && requestWeights) {
            try {
                const gathered = await fetchContextByClassification(classification, requestWeights, entityIndex, entityTypes);
                gatheredStr = serializeGatheredContext(gathered);
                context.set('__hz_gathered_context', gathered);
                context.set('__hz_gathered_context_str', gatheredStr);
                debug('pipeline', `Hz plan: initial context: ${gathered.nodes.length} entities`);
            } catch (err) {
                debug('pipeline', `Hz plan: context fetch failed: ${err}`);
            }
        }

        // ── Failure note for retry replanning ─────────────────────────────────
        const evaluationReasoning = context.getString('__hz_evaluation_reasoning') ?? '';
        const previousActionLog = (context.get('__hz_action_log') as string[] | null) ?? [];
        const failureNote = retryCount > 0 && evaluationReasoning
            ? `\nPREVIOUS ATTEMPT FAILED (retry ${retryCount}): ${evaluationReasoning}\nPrevious actions:\n${previousActionLog.map(l => `  ${l}`).join('\n')}\nRevise the plan to address the failure.\n`
            : '';

        // ── Generate execution plan ───────────────────────────────────────────
        let raw: string;
        try {
            const categorizeLlm = await getModelForCapability('categorize');
            raw = await categorizeLlm.chat(
                [{
                    role: 'user' as const,
                    content: `${failureNote}Create an execution plan for this request.

USER REQUEST: "${userInput}"
CATEGORY: ${category} | TYPE: ${requestType}
INTENT: ${intentSummary}

INITIAL CONTEXT:
${gatheredStr || '(no entities found yet)'}

AVAILABLE STEP TYPES:
- query_context   — search the vault for entities (tasks, people, events, notes)
- query_catalog   — search for and select capability nodes (tools/actions)
- build_process   — design a Feral automation process from selected nodes
- execute_process — run the designed process

GUIDELINES:
- For a QUERY (list tasks, find person, show me X): ONLY [query_context]. The synthesis step presents gathered entities automatically — do NOT add catalog/process steps. Success = the entities are in gathered context.
- For an ACTION (create task, update event, complete task, set a field): [query_context, query_catalog, build_process, execute_process]. Process execution is required for mutations.
- Only include steps that are actually needed — fewer is better.
- Success criteria must describe DATA STATE only: entity created/updated/found. Never require formatting, messages, or responses.

Return JSON only:
{
  "reasoning": "Chain-of-thought: what does this request need and why?",
  "steps": [
    { "type": "query_context",   "description": "What to search for",       "hint": "search terms" },
    { "type": "query_catalog",   "description": "What capabilities needed" },
    { "type": "build_process",   "description": "What the process must do" },
    { "type": "execute_process", "description": "Expected data state" }
  ],
  "success_criteria": "One sentence: what data state = success",
  "success_checklist": ["Verifiable condition 1", "Verifiable condition 2"]
}`,
                }],
                {
                    systemPrompt: 'You are a chain-of-thought planner for an AI personal assistant. For queries, plan ONLY [query_context] — synthesis presents gathered entities automatically without process execution. For actions (mutations), plan [query_context, query_catalog, build_process, execute_process]. Success criteria must be DATA STATE only — entity found, created, or updated.',
                    temperature: 0.2,
                },
            );
        } catch (err) {
            return this.setFallbackPlan(context, requestType, userInput, err);
        }

        try {
            const parsed = parseJsonResponse(raw) as {
                reasoning: string;
                steps: HertzPlanStep[];
                success_criteria: string;
                success_checklist: string[];
            };

            context.set('__hz_plan_reasoning', parsed.reasoning ?? '');
            context.set('__hz_plan_steps', parsed.steps ?? []);
            context.set('__hz_success_criteria', parsed.success_criteria ?? userInput);
            context.set('__hz_success_checklist', parsed.success_checklist ?? [parsed.success_criteria ?? userInput]);

            debug('pipeline', `Hz plan: ${parsed.steps?.length ?? 0} steps. Success: "${parsed.success_criteria}"`);
            return this.result(ResultStatus.OK, `Plan created: ${parsed.steps?.length ?? 0} steps.`);
        } catch (err) {
            return this.setFallbackPlan(context, requestType, userInput, err);
        }
    }

    private setFallbackPlan(context: Context, requestType: string, userInput: string, err: unknown): Result {
        const steps: HertzPlanStep[] = requestType === 'query'
            ? [{ type: 'query_context', description: 'Search for relevant entities', hint: userInput }]
            : [
                { type: 'query_context',   description: 'Fetch relevant context' },
                { type: 'query_catalog',   description: 'Find required capability nodes' },
                { type: 'build_process',   description: 'Design the automation process' },
                { type: 'execute_process', description: 'Run the process' },
            ];
        context.set('__hz_plan_reasoning', 'Default plan (generation failed).');
        context.set('__hz_plan_steps', steps);
        context.set('__hz_success_criteria', `The user's request was fulfilled: "${userInput}"`);
        context.set('__hz_success_checklist', [userInput]);
        debug('pipeline', `Hz plan fallback: ${err}`);
        return this.result(ResultStatus.ERROR, `Plan generation failed — using default: ${err instanceof Error ? err.message : String(err)}`);
    }
}
