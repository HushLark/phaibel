// ─────────────────────────────────────────────────────────────────────────────
// Hertz Pipeline — Step 3: Execute
// ─────────────────────────────────────────────────────────────────────────────
//
// Chain-of-thought execution loop.  At each iteration the LLM sees the plan,
// current state (gathered context, selected nodes, process status), and action
// log, then chooses ONE of:
//
//   query_context   — search vault for entities
//   query_catalog   — search catalog and select capability nodes
//   build_process   — ask reason LLM to design a Feral process JSON
//   execute_process — run the built process via the shared engine
//   done            — exit the loop (context/results sufficient)
//
// Max MAX_ITERATIONS iterations.  Gathered context and action log are persisted
// to context for hz_evaluate and hz_plan (retry replanning).
//
// Reads: user_input, __hz_intent_summary, __hz_plan_steps, __hz_success_criteria,
//        __hz_success_checklist, __hz_retry_count, __hz_evaluation_reasoning,
//        __hz_gathered_context, __hz_gathered_context_str, __classification,
//        __request_weights, __entity_index, __entity_types, __bootstrap_runtime,
//        __process_engine, __on_status
// Writes: __hz_gathered_context, __hz_gathered_context_str, __hz_selected_node_keys,
//         __hz_process_json, __hz_action_log, __all_reasonings
// Result: ok | error
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { searchCatalog, buildCatalogOverview } from '../../catalog/catalog-search.js';
import { getModelForCapability } from '../../../llm/router.js';
import { parseJsonResponse } from '../../../utils/json-parser.js';
import { debug } from '../../../utils/debug.js';
import { fetchContextByClassification, serializeGatheredContext } from '../../../context/context-loop.js';
import type { GatheredContext } from '../../../context/context-loop.js';
import type { ClassificationResult } from '../../../context/request-classifier.js';
import type { RequestWeights } from '../../../context/request-weights.js';
import type { EntityIndex } from '../../../entities/entity-index.js';
import type { EntityTypeConfig } from '../../../entities/entity-type-config.js';
import type { FeralRuntime } from '../../bootstrap.js';
import type { CatalogNode } from '../../catalog/catalog-node.js';
import type { ProcessEngine } from '../../engine/process-engine.js';
import { hydrateProcess, type ProcessConfigJson } from '../../process/process-json-hydrator.js';
import { EXAMPLE_PROCESSES } from '../../../commands/chat-helpers.js';
import type { HertzPlanStep } from './hz-plan-node-code.js';

const MAX_ITERATIONS = 7;

interface HertzAction {
    reasoning: string;
    action: 'query_context' | 'query_catalog' | 'build_process' | 'execute_process' | 'done';
    search_query?: string;     // query_context
    search_queries?: string[]; // query_catalog
    select_nodes?: string[];   // query_catalog
}

export class HZExecuteNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK,    description: 'Execution loop completed.' },
        { status: ResultStatus.ERROR, description: 'Unrecoverable error in execution loop.' },
    ];

    constructor() {
        super(
            'hz_execute',
            'Hz: Execute',
            `Chain-of-thought execution loop: context query, catalog query, build process, or execute process (max ${MAX_ITERATIONS} iterations). Step 3 of Hertz.`,
            'pipeline',
        );
    }

    async process(context: Context): Promise<Result> {
        const userInput = context.getString('user_input') ?? '';
        const intentSummary = context.getString('__hz_intent_summary') ?? userInput;
        const planSteps = (context.get('__hz_plan_steps') as HertzPlanStep[] | null) ?? [];
        const successCriteria = context.getString('__hz_success_criteria') ?? userInput;
        const retryCount = (context.get('__hz_retry_count') as number | null) ?? 0;
        const onStatus = context.get('__on_status') as ((s: string) => void) | null;

        const classification = context.get('__classification') as ClassificationResult | null;
        const requestWeights = context.get('__request_weights') as RequestWeights | null;
        const entityIndex = context.get('__entity_index') as EntityIndex | null;
        const entityTypes = (context.get('__entity_types') as EntityTypeConfig[] | null) ?? [];
        const runtime = context.get('__bootstrap_runtime') as FeralRuntime | null;
        const engine = context.get('__process_engine') as ProcessEngine | null;

        // ── Restore accumulated context from plan step (or prior retry) ───────
        let gatheredCtx: GatheredContext = (context.get('__hz_gathered_context') as GatheredContext | null)
            ?? { nodes: [], summary: 'none', rounds: 0 };
        let gatheredStr = context.getString('__hz_gathered_context_str') ?? serializeGatheredContext(gatheredCtx);

        // Action log — prepend retry note if applicable
        const actionLog: string[] = [];
        if (retryCount > 0) {
            const prevEval = context.getString('__hz_evaluation_reasoning') ?? 'previous attempt did not meet success criteria';
            actionLog.push(`[RETRY ${retryCount}] Replanning after: ${prevEval}`);
        }

        const surfacedNodes = new Map<string, CatalogNode>();
        const selectedNodeKeys = new Set<string>(['start', 'stop']);
        let processJson: Record<string, unknown> | null = null;
        const completedActionTypes = new Set<string>();

        const allNodes = runtime?.catalog.getAllCatalogNodes() ?? [];
        const catalogOverview = buildCatalogOverview(allNodes);
        if (runtime) {
            try { surfacedNodes.set('start', runtime.catalog.getCatalogNode('start')); } catch { /* skip */ }
            try { surfacedNodes.set('stop',  runtime.catalog.getCatalogNode('stop'));  } catch { /* skip */ }
        }

        const categorizeLlm = await getModelForCapability('categorize');
        const reasonLlm = await getModelForCapability('reason');

        // Format plan as a guide (no rigid done/pending markers — let agent reason from action log)
        const formatPlan = (): string => {
            if (planSteps.length === 0) return '  (no plan — acting directly from request)';
            return planSteps.map((s, i) =>
                `  ${i + 1}. ${s.type}: ${s.description}${s.hint ? ` (hint: ${s.hint})` : ''}`
            ).join('\n');
        };

        // ── Main execution loop ───────────────────────────────────────────────
        for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
            const selectedDetails = Array.from(selectedNodeKeys)
                .filter(k => k !== 'start' && k !== 'stop' && surfacedNodes.has(k))
                .map(k => `  ${k}: ${surfacedNodes.get(k)!.description ?? ''}`)
                .join('\n') || '  (none — use query_catalog to search and auto-select nodes)';

            // Explicit entity manifest — prevents hallucination by listing exact [type:id] pairs
            const entityManifest = gatheredCtx.nodes.length > 0
                ? gatheredCtx.nodes.map(n => {
                    const node = n as { type?: string; id?: string; name?: string };
                    return `  [${node.type ?? '?'}:${node.id ?? '?'}] ${node.name ?? node.id ?? '?'}`;
                }).join('\n')
                : '  (none — use query_context to fetch entities first)';

            // ── Ask LLM for next action ───────────────────────────────────────
            let actionDecision: HertzAction;
            try {
                const raw = await categorizeLlm.chat(
                    [{
                        role: 'user' as const,
                        content: `HERTZ CHAIN-OF-THOUGHT AGENT
==============================

REQUEST: "${userInput}"
INTENT: ${intentSummary}
SUCCESS: ${successCriteria}

PLAN (guide only — skip steps satisfied by gathered context or action log):
${formatPlan()}

CATALOG OVERVIEW:
${catalogOverview}

GATHERED ENTITIES (authoritative list — do NOT claim an entity is present unless its [type:id] appears here):
${entityManifest}

GATHERED CONTEXT DETAILS:
${gatheredStr || '(empty — use query_context to search vault)'}

SELECTED CATALOG NODES (ready for build_process):
${selectedDetails}

PROCESS: ${processJson ? 'Built ✓ — choose execute_process now' : '(not built yet)'}

ACTION LOG:
${actionLog.length > 0 ? actionLog.map((l, i) => `  ${i + 1}. ${l}`).join('\n') : '  (no actions yet)'}

---
RULES:
1. Trust GATHERED ENTITIES above all else. If an entity's [type:id] is not listed, run query_context to find it.
2. Catalog search auto-selects the top matching nodes. Use select_nodes for known keys (e.g. "create_task").
3. For queries (list/find/show): choose "done" once target entities appear in GATHERED ENTITIES.
4. For actions (create/update/complete): choose "done" after execute_process succeeds.
5. CRITICAL: If PROCESS shows "Built ✓", choose execute_process immediately — do NOT build again unless execute failed with an error requiring config changes.

Choose the next action:
  query_context    — search vault for relevant entities
  query_catalog    — search catalog (top results auto-selected); provide select_nodes for known keys
  build_process    — design a Feral process (only when PROCESS is not yet built, or after execute failed)
  execute_process  — run the built process (immediately after PROCESS shows "Built ✓")
  done             — queries: entities visible in GATHERED ENTITIES; actions: execute_process succeeded

Return JSON only:
{
  "reasoning": "brief chain-of-thought",
  "action": "query_context|query_catalog|build_process|execute_process|done",
  "search_query": "for query_context only",
  "search_queries": ["for query_catalog"],
  "select_nodes": ["optional — known node keys to select directly"]
}`,
                    }],
                    {
                        systemPrompt: 'You are a chain-of-thought execution agent for an AI personal assistant. CRITICAL RULES: (1) Only claim an entity is present if its [type:id] is in GATHERED ENTITIES — never infer. (2) Catalog search auto-selects top results. (3) Once PROCESS is "Built ✓", choose execute_process IMMEDIATELY — never rebuild unless execute failed with a config error. Catalog keys: create_{type}, find_{type}, update_{type}, complete_{type}, list_{type}s, set_{type}_{field}.',
                        temperature: 0.2,
                    },
                );
                actionDecision = parseJsonResponse(raw) as unknown as HertzAction;
            } catch (err) {
                debug('pipeline', `Hz execute: action decision failed at iter ${iter}: ${err}`);
                actionLog.push(`[${iter + 1}] action-decision error: ${err instanceof Error ? err.message : err}`);
                break;
            }

            const act = actionDecision.action;
            debug('pipeline', `Hz execute iter ${iter + 1}: ${act} — ${actionDecision.reasoning}`);

            if (act === 'done') {
                actionLog.push(`[${iter + 1}] done: ${actionDecision.reasoning}`);
                break;
            }

            // ── query_context ─────────────────────────────────────────────────
            if (act === 'query_context') {
                if (!entityIndex || !classification || !requestWeights) {
                    actionLog.push(`[${iter + 1}] query_context: skipped — no entity index in context`);
                } else {
                    onStatus?.('Querying context…');
                    const query = actionDecision.search_query ?? userInput;
                    try {
                        const synClass: ClassificationResult = { ...classification, summary: query };
                        const extra = await fetchContextByClassification(synClass, requestWeights, entityIndex, entityTypes);
                        const existingIds = new Set(gatheredCtx.nodes.map(n => (n as { id: string }).id));
                        let added = 0;
                        for (const node of extra.nodes) {
                            const nid = (node as { id: string }).id;
                            if (!existingIds.has(nid)) {
                                gatheredCtx.nodes.push(node);
                                existingIds.add(nid);
                                added++;
                            }
                        }
                        gatheredStr = serializeGatheredContext(gatheredCtx);
                        actionLog.push(`[${iter + 1}] query_context "${query}" → ${added} new (${gatheredCtx.nodes.length} total)`);
                        completedActionTypes.add('query_context');
                    } catch (err) {
                        actionLog.push(`[${iter + 1}] query_context "${actionDecision.search_query}" → error: ${err instanceof Error ? err.message : err}`);
                    }
                }
            }

            // ── query_catalog ─────────────────────────────────────────────────
            else if (act === 'query_catalog') {
                onStatus?.('Searching catalog…');
                const queries = actionDecision.search_queries ?? [userInput];
                const newlyFoundKeys: string[] = [];
                for (const q of queries) {
                    const { nodes: results } = searchCatalog(allNodes, q);
                    for (const n of results) {
                        if (!surfacedNodes.has(n.key)) {
                            surfacedNodes.set(n.key, n);
                            newlyFoundKeys.push(n.key);
                        }
                    }
                }
                // Explicit select_nodes takes priority; fall back to auto-selecting top newly found nodes.
                // This prevents the two-step search→select cycle where the agent searches but forgets
                // to include select_nodes, causing an endless re-search loop.
                const explicitSelectKeys = actionDecision.select_nodes ?? [];
                const keysToSelect = explicitSelectKeys.length > 0 ? explicitSelectKeys : newlyFoundKeys.slice(0, 5);
                let selected = 0;
                for (const key of keysToSelect) {
                    if (!surfacedNodes.has(key) && runtime) {
                        try { surfacedNodes.set(key, runtime.catalog.getCatalogNode(key)); } catch { continue; }
                    }
                    if (surfacedNodes.has(key) && !selectedNodeKeys.has(key)) {
                        selectedNodeKeys.add(key);
                        selected++;
                    }
                }
                actionLog.push(`[${iter + 1}] query_catalog [${queries.join(', ')}] → found ${newlyFoundKeys.length} new, selected ${selected} (total selected: ${selectedNodeKeys.size - 2})`);
                completedActionTypes.add('query_catalog');
            }

            // ── build_process ─────────────────────────────────────────────────
            else if (act === 'build_process') {
                // Auto-promote AVAILABLE nodes if nothing is selected yet — prevents the loop where
                // query_catalog surfaced nodes but the agent skipped the explicit select step.
                if (Array.from(selectedNodeKeys).filter(k => k !== 'start' && k !== 'stop').length === 0) {
                    const available = Array.from(surfacedNodes.entries())
                        .filter(([k]) => k !== 'start' && k !== 'stop' && !selectedNodeKeys.has(k));
                    for (const [key] of available.slice(0, 5)) {
                        selectedNodeKeys.add(key);
                    }
                }
                const workingKeys = Array.from(selectedNodeKeys)
                    .filter(k => k !== 'start' && k !== 'stop' && surfacedNodes.has(k));
                if (workingKeys.length === 0) {
                    actionLog.push(`[${iter + 1}] build_process: skipped — no nodes found yet. Use query_catalog to search.`);
                } else {
                    onStatus?.('Building process…');
                    const nodeDetails = ['start', 'stop', ...workingKeys]
                        .filter(k => surfacedNodes.has(k))
                        .map(k => {
                            const n = surfacedNodes.get(k)!;
                            return `  ${n.key} [${n.group}]: ${n.description ?? ''}`;
                        }).join('\n');

                    const successChecklist = (context.get('__hz_success_checklist') as string[] | null) ?? [];
                    const successBlock = `SUCCESS CRITERIA:\n${successCriteria}\n${successChecklist.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}`;

                    const examplesStr = EXAMPLE_PROCESSES.map((ex, i) =>
                        `Example ${i + 1}: ${ex.description}\n${JSON.stringify(ex.json, null, 2)}`
                    ).join('\n\n');

                    try {
                        const raw = await reasonLlm.chat(
                            [{
                                role: 'user' as const,
                                content: `Build a Feral process to handle: "${userInput}"

${gatheredStr}
${successBlock}

CATALOG NODES (use ONLY these):
${nodeDetails}

PROCESS RULES:
1. schema_version=1, key="hz.generated". First: key="start", catalog_node_key="start". Last: key="done", catalog_node_key="stop", edges={}.
2. "edges" maps result statuses to next node key. Most nodes produce "ok" and "error".
3. Context starts with user_input="${userInput}". Keep processes simple — fewer nodes is better.
4. For entity creation: ALWAYS set entity_title and entity_body with concrete values.
5. create_* nodes ONLY accept: entity_type, entity_title, entity_body, extra_fields. Put field values in process "context" object, list field names in extra_fields.
6. DATE FORMAT: date→YYYY-MM-DD, datetime→ISO 8601 with timezone. Events ALWAYS need startDate. Include duration (e.g. "PT1H"). Default to 09:00 if no time given.
7. CRITICAL: Match entity types precisely. event≠task. Use create_event for meetings, create_task for todos.
8. When referencing existing entities, use EXACT titles from the gathered context.
9. Use complete_task (NOT update_task with status) to mark a task done. Valid task statuses: open, in-progress, done, blocked.
10. generate_markdown requires input_context_path pointing to an EXISTING public context key.

EXAMPLES:
${examplesStr}

Return JSON only:
{ "reasoning": "One sentence explaining the process design", "process": { ...process JSON... } }`,
                            }],
                            {
                                systemPrompt: 'Generate a valid Feral process JSON using the provided catalog nodes to achieve the success criteria. catalog_node_key values must match exactly.',
                                temperature: 0.3,
                                maxTokens: 16384,
                            },
                        );

                        const design = parseJsonResponse(raw) as { reasoning: string; process: Record<string, unknown> };
                        processJson = design.process;
                        context.set('__hz_process_json', processJson);
                        actionLog.push(`[${iter + 1}] build_process: "${design.reasoning}"`);
                        completedActionTypes.add('build_process');
                    } catch (err) {
                        actionLog.push(`[${iter + 1}] build_process: failed — ${err instanceof Error ? err.message : err}`);
                    }
                }
            }

            // ── execute_process ───────────────────────────────────────────────
            else if (act === 'execute_process') {
                if (!processJson) {
                    actionLog.push(`[${iter + 1}] execute_process: skipped — no process built. Use build_process first.`);
                } else if (!engine) {
                    actionLog.push(`[${iter + 1}] execute_process: skipped — no process engine in context`);
                } else {
                    onStatus?.('Running process…');
                    try {
                        engine.clearCache();
                        const inlineProcess = hydrateProcess(processJson as unknown as ProcessConfigJson);
                        await engine.process(inlineProcess, context);
                        engine.clearCache();
                        actionLog.push(`[${iter + 1}] execute_process: completed`);
                        completedActionTypes.add('execute_process');
                    } catch (err) {
                        actionLog.push(`[${iter + 1}] execute_process: failed — ${err instanceof Error ? err.message : err}`);
                        engine.clearCache();
                    }
                }
            }
        }

        // ── Persist state for evaluate step ───────────────────────────────────
        context.set('__hz_gathered_context', gatheredCtx);
        context.set('__hz_gathered_context_str', gatheredStr);
        context.set('__hz_selected_node_keys', Array.from(selectedNodeKeys));
        context.set('__hz_action_log', actionLog);
        context.set('__all_reasonings', actionLog);

        debug('pipeline', `Hz execute: ${actionLog.length} actions, ${completedActionTypes.size} types completed`);
        return this.result(ResultStatus.OK, `Execution complete: ${actionLog.length} actions.`);
    }
}
