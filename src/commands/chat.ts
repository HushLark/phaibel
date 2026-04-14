// ─────────────────────────────────────────────────────────────────────────────
// Feral Autonomous Chat — Two-Phase Pipeline
// ─────────────────────────────────────────────────────────────────────────────
//
// Phase 1 (Process Reuse): Present ALL known processes to the LLM and let it
//   pick one if it clearly fits, or choose "custom" to build from scratch.
//
// Phase 2 (Custom Pipeline): Only runs when Phase 1 chose "custom" (or no
//   processes exist). A multi-step LLM pipeline that:
//     1. Selects catalog nodes relevant to the user's request
//     2. Generates a Feral process JSON using those nodes
//     3. Runs the process, checks completion, iterates if needed
//     4. Synthesizes a natural response
// ─────────────────────────────────────────────────────────────────────────────

import chalk from 'chalk';
import inquirer from 'inquirer';
import { bootstrapFeral, type BootstrapOptions } from '../feral/bootstrap.js';
import { hydrateProcessFromString } from '../feral/process/process-json-hydrator.js';
import type { ProcessSource } from '../feral/process/process-factory.js';
import type { Process } from '../feral/process/process.js';
import { getModelForCapability, createSystemPrompt } from '../llm/router.js';
import { debug } from '../utils/debug.js';
import { ChatLogger, generateChatId, appendJudgement } from '../utils/chat-logger.js';
import { parseJsonResponse } from '../utils/json-parser.js';
import { writeExecutionLog } from '../utils/execution-logger.js';
import { loadEntityTypes } from '../entities/entity-type-config.js';
import { getUserName } from '../state/manager.js';
import { getVaultContext } from '../context/reader.js';
import { getEntityIndex } from '../entities/entity-index.js';
import { buildContextTree, expandContextTree } from '../context/context-tree.js';
import { serializeContextTree } from '../context/context-tree-serializer.js';
import { classifyScope } from '../context/scope-classifier.js';
import { analyzeQueryRelevance, filterCatalogNodes } from '../context/query-relevance.js';
import { buildMomentContext, momentToGlobals } from '../context/moment.js';
import { updateProfile, validateScores, invalidateProfileCache, type BigFiveSample } from '../personality/big-five.js';
import { generateNodeId, ensureEntityDir, writeEntity, nodeFilename } from '../entities/entity.js';
import { getEntityType } from '../entities/entity-type-config.js';
import type { LLMProvider } from '../llm/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY PROCESS SOURCE
// ─────────────────────────────────────────────────────────────────────────────

class InMemoryProcessSource implements ProcessSource {
    private processes: Process[] = [];

    add(process: Process): void {
        this.processes.push(process);
    }

    getProcesses(): Process[] {
        return this.processes;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXAMPLE PROCESSES (for the LLM prompt)
// ─────────────────────────────────────────────────────────────────────────────

const EXAMPLE_PROCESSES = [
    {
        description: 'Create multiple entities: a goal and a todont from user input',
        json: {
            schema_version: 1,
            key: 'multi.create',
            description: 'Create a goal and a todont based on user input',
            context: {},
            nodes: [
                { key: 'start', catalog_node_key: 'start', configuration: {}, edges: { ok: 'create_goal' } },
                { key: 'create_goal', catalog_node_key: 'create_goal', configuration: { entity_title: 'Run 10 miles', entity_body: 'Train progressively to run 10 miles by mid-March' }, edges: { ok: 'create_todont', already_exists: 'create_todont', error: 'create_todont' } },
                { key: 'create_todont', catalog_node_key: 'create_todont', configuration: { entity_title: 'No pizza or beer', entity_body: 'Avoid pizza and beer while training for the 10-mile run' }, edges: { ok: 'done', already_exists: 'done', error: 'done' } },
                { key: 'done', catalog_node_key: 'stop', configuration: {}, edges: {} },
            ],
        },
    },
    {
        description: 'Complete a task: find it by title and mark it as done',
        json: {
            schema_version: 1,
            key: 'task.complete',
            description: 'Mark a task as done',
            context: {},
            nodes: [
                { key: 'start', catalog_node_key: 'start', configuration: {}, edges: { ok: 'complete' } },
                { key: 'complete', catalog_node_key: 'complete_task', configuration: { entity_title: 'Buy groceries' }, edges: { ok: 'done', not_found: 'done', error: 'done' } },
                { key: 'done', catalog_node_key: 'stop', configuration: {}, edges: {} },
            ],
        },
    },
    {
        description: 'Create a new content type then create an entity of that type',
        json: {
            schema_version: 1,
            key: 'type.create_and_populate',
            description: 'Create a recipe content type and add a recipe',
            context: {},
            nodes: [
                { key: 'start', catalog_node_key: 'start', configuration: {}, edges: { ok: 'create_type' } },
                { key: 'create_type', catalog_node_key: 'create_content_type', configuration: { type_name: 'recipe', description: 'A cooking recipe with ingredients, instructions, prep time, and servings' }, edges: { ok: 'create_entity', already_exists: 'create_entity', error: 'done' } },
                { key: 'create_entity', catalog_node_key: 'create_entity', configuration: { entity_type: 'recipe', entity_title: 'Chocolate Chip Cookies', entity_body: 'Ingredients: flour, butter, sugar, eggs, chocolate chips.\nBake at 375F for 10 min.', tags: 'dessert,baking' }, edges: { ok: 'done', already_exists: 'done', error: 'done' } },
                { key: 'done', catalog_node_key: 'stop', configuration: {}, edges: {} },
            ],
        },
    },
    {
        description: 'Create an event with fields set via initial context',
        json: {
            schema_version: 1,
            key: 'event.create',
            description: 'Create a dentist appointment event with date, time, and location',
            context: { startDate: '2026-04-10T09:00:00-06:00', endDate: '2026-04-10T10:00:00-06:00', location: 'Downtown Dental, 123 Main St' },
            nodes: [
                { key: 'start', catalog_node_key: 'start', configuration: {}, edges: { ok: 'create' } },
                { key: 'create', catalog_node_key: 'create_event', configuration: { entity_title: 'Dentist Appointment', entity_body: 'Regular dental checkup', extra_fields: 'startDate,endDate,location' }, edges: { ok: 'done', already_exists: 'done', error: 'done' } },
                { key: 'done', catalog_node_key: 'stop', configuration: {}, edges: {} },
            ],
        },
    },
    {
        description: 'Create a task with fields (status, priority, dueDate) set via process context',
        json: {
            schema_version: 1,
            key: 'task.create',
            description: 'Create a task to buy groceries due today',
            context: { status: 'open', priority: 'medium', dueDate: '2026-04-09' },
            nodes: [
                { key: 'start', catalog_node_key: 'start', configuration: {}, edges: { ok: 'create' } },
                { key: 'create', catalog_node_key: 'create_task', configuration: { entity_title: 'Buy groceries', entity_body: 'Pick up groceries from the store.', extra_fields: 'status,priority,dueDate' }, edges: { ok: 'done', already_exists: 'done', error: 'done' } },
                { key: 'done', catalog_node_key: 'stop', configuration: {}, edges: {} },
            ],
        },
    },
];

// ─────────────────────────────────────────────────────────────────────────────
// CONVERSATION HISTORY
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatHistoryEntry {
    role: 'user' | 'assistant';
    content: string;
}

const MAX_HISTORY_PAIRS = 3;

/**
 * Format recent history into a block the LLM can reference.
 */
function formatHistoryBlock(history: ChatHistoryEntry[]): string {
    if (history.length === 0) return '';
    const lines = history.map(h =>
        h.role === 'user' ? `User: ${h.content}` : `Assistant: ${h.content}`,
    );
    return `\nRECENT CONVERSATION (last ${Math.ceil(history.length / 2)} exchange(s) — use this for context when the user refers to previous requests):\n${lines.join('\n')}\n`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE: feralChatHeadless — headless pipeline, returns the response string
// ─────────────────────────────────────────────────────────────────────────────

export async function feralChatHeadless(
    userInput: string,
    onStatus?: (status: string) => void,
    onProcess?: (processJson: Record<string, unknown>) => void,
    onQuestion?: (question: string, options?: string[]) => Promise<string>,
    onChatId?: (chatId: string) => void,
    history?: ChatHistoryEntry[],
    platform?: BootstrapOptions['platform'],
): Promise<string> {
    const status = (s: string) => onStatus?.(s);
    const chatId = generateChatId();
    const logger = new ChatLogger(chatId);

    // Record chat in analytics (fire-and-forget)
    import('../analytics/analytics-service.js')
        .then(({ getAnalyticsService }) => getAnalyticsService().recordChat())
        .catch(() => {});

    // Fire the chat ID callback immediately so callers can display/send it
    onChatId?.(chatId);

    status('Thinking…');

    try { return await _feralChatHeadlessInner(userInput, status, onProcess, onQuestion, logger, chatId, history ?? [], platform); }
    catch (error) {
        await logger.log('error', { message: error instanceof Error ? error.message : String(error) });
        throw error;
    } finally {
        logger.close();
    }
}

async function _feralChatHeadlessInner(
    userInput: string,
    status: (s: string) => void,
    onProcess: ((processJson: Record<string, unknown>) => void) | undefined,
    onQuestion: ((question: string, options?: string[]) => Promise<string>) | undefined,
    logger: ChatLogger,
    chatId: string,
    history: ChatHistoryEntry[],
    platform?: BootstrapOptions['platform'],
): Promise<string> {
    // ── Bootstrap Feral + load entity types + vault context ────────
    const inMemorySource = new InMemoryProcessSource();
    const [runtime, entityTypes, userName] = await Promise.all([
        bootstrapFeral({ processSources: [inMemorySource], platform }),
        loadEntityTypes().catch(() => []),
        getUserName().catch(() => 'friend'),
    ]);

    await logger.log('start', { chatId, userInput });

    // Load vault context (.vault.md chain)
    // Scrub any secrets that may have been accidentally pasted into .vault.md files
    const vaultContext = scrubSecrets(await getVaultContext().catch(() => '')) as string;

    // ── Build context tree with moment context ─────────────────────
    const entityIndex = getEntityIndex();
    if (!entityIndex.isBuilt) await entityIndex.build();

    const moment = buildMomentContext();
    const globalsMap = momentToGlobals(moment, userName);

    const scope = classifyScope(userInput, entityTypes, entityIndex.getStats());
    const contextTree = await buildContextTree(scope, globalsMap);
    let contextTreeStr = serializeContextTree(contextTree);

    debug('chat', `Context tree: scope=${scope.type}, tokens≈${Math.ceil(contextTreeStr.length / 4)}`);

    const allNodes = runtime.catalog.getAllCatalogNodes();

    // Deterministic pre-filter: narrow catalog nodes to relevant entity types
    const relevance = analyzeQueryRelevance(userInput, entityTypes, entityIndex);
    const filteredNodes = filterCatalogNodes(
        allNodes.filter(n => !n.key.startsWith('speak_')),
        relevance.relevantTypes,
        entityTypes,
    );

    // Build catalog summary for LLM (only relevant nodes)
    const catalogSummary = filteredNodes
        .map(n => `- ${n.key}: ${n.description || n.name} [group: ${n.group}]`)
        .join('\n');

    const relevanceHintBlock = relevance.relevanceHint
        ? `\nQUERY RELEVANCE (entity matches from vault search):\n${relevance.relevanceHint}\n`
        : '';

    debug('chat', `Catalog has ${allNodes.length} nodes, sending ${filteredNodes.length} after relevance filter (${relevance.relevantTypes.map(rt => rt.type).join(', ') || 'all'})`);

    const llm = await getModelForCapability('reason');

    // ── PHASE 1: Process reuse ─────────────────────────────────────────
    // Show the LLM ALL known processes and let it pick one, or choose "custom".
    const allProcesses = runtime.processFactory.getAllProcesses()
        .filter(p => p.key !== 'chat.generated');

    if (allProcesses.length > 0) {
        status('Checking process library…');

        const processSummary = allProcesses
            .map(p => `- ${p.key}: ${p.description}`)
            .join('\n');

        const historyBlock = formatHistoryBlock(history);

        const phase1Response = await llm.chat(
            [{
                role: 'user' as const,
                content: `The user said: "${userInput}"
${historyBlock}
AVAILABLE PROCESSES:
${processSummary}

You can either:
1. REUSE an existing process if it clearly fits the request
2. Choose CUSTOM to build a new process from scratch

Return JSON:
If reuse: { "action": "reuse", "process_key": "the.key", "context_overrides": {}, "reasoning": "why" }
If custom: { "action": "custom", "reasoning": "why no existing process fits" }

Return ONLY the JSON object, no markdown fences.`,
            }],
            {
                systemPrompt: 'You are the process matcher for Phaibel. Determine if an existing reusable process can handle the user\'s request. Be conservative — only reuse if the process clearly fits. Better to build custom than force-fit.',
                temperature: 0.2,
            },
        );

        debug('chat', `Phase 1 response: ${phase1Response}`);

        try {
            const matchResult = parseJsonResponse(phase1Response) as {
                action: string;
                process_key?: string;
                context_overrides?: Record<string, unknown>;
                reasoning: string;
            };

            await logger.log('process_match', { ...matchResult });

            if (matchResult.action === 'reuse' && matchResult.process_key) {
                status('Running matched process…');
                debug('chat', `Matched process: ${matchResult.process_key}`);

                let contextResult: Record<string, unknown>;
                let success = true;
                try {
                    const ctx = await runtime.runner.run(matchResult.process_key, {
                        user_input: userInput,
                        ...(matchResult.context_overrides || {}),
                        ...(onQuestion ? { _askQuestion: onQuestion } : {}),
                    });
                    contextResult = ctx.getAll();
                } catch (error) {
                    debug('chat', `Matched process execution failed: ${error}`);
                    contextResult = { _error: error instanceof Error ? error.message : String(error) };
                    success = false;
                }

                const filteredResult = Object.entries(contextResult)
                    .filter(([k]) => !k.startsWith('_') && k !== 'user_input')
                    .reduce((acc, [k, v]) => {
                        acc[k] = typeof v === 'string' && v.length > 2000 ? v.slice(0, 2000) + '…' : v;
                        return acc;
                    }, {} as Record<string, unknown>);

                const scrubbedResult = scrubSecrets(filteredResult) as Record<string, unknown>;

                await logger.log('process_result', { iteration: 1, results: scrubbedResult, source: 'reuse' });

                const matchedProcess = allProcesses.find(p => p.key === matchResult.process_key);

                // Synthesize response
                const finalResponse = await synthesizeResponse(
                    llm, userInput, matchResult.reasoning,
                    [scrubbedResult], [], vaultContext, history, chatId,
                );
                await logger.log('response', { response: finalResponse });

                // Fire-and-forget execution log
                writeExecutionLog({
                    timestamp: new Date().toISOString(),
                    chat_id: chatId,
                    user_input: userInput,
                    process_source: 'reuse',
                    process_key: matchResult.process_key,
                    process_json: matchedProcess ? { key: matchedProcess.key, description: matchedProcess.description } : {},
                    context_result: scrubbedResult,
                    success,
                    outcome_summary: finalResponse.slice(0, 500),
                    iterations: 1,
                }).catch(err => debug('chat', `Execution log write failed: ${err}`));

                return finalResponse;
            }
        } catch {
            debug('chat', 'Phase 1 parse failed, falling through to custom pipeline');
        }
    }

    // ── PHASE 2: Custom process pipeline ─────────────────────────────
    // Only runs if Phase 1 chose "custom", no processes exist, or parse failed.

    // ── STEP 1: Select catalog nodes ─────────────────────────────────
    status('Selecting capabilities…');

    const historyBlock = formatHistoryBlock(history);

    const step1Response = await llm.chat(
        [{
            role: 'user' as const,
            content: `The user said: "${userInput}"
${historyBlock}
${contextTreeStr}

ENTITY TYPE CONVENTIONS:
The agent manages the entity types listed above. When the user mentions something that maps to an entity, prefer creating it.
Each entity type has create_*, list_*, find_*, update_*, delete_*, complete_* catalog nodes, plus set_{type}_{field} nodes for each field.
For example: create_task, list_tasks, find_note, set_task_status, complete_task, etc.

IMPORTANT CAPABILITIES:
- To filter entities by tag, use the "tags" config on list_* or search_* nodes (comma-separated tag names).
- To mark an entity as done/complete, use the complete_* node (e.g. complete_task).
- To create a NEW content type for something tangible the user wants to track (e.g. "recipe", "flight", "medication"), use "create_content_type". Keep the description SHORT and simple — the LLM will design minimal fields. If a content type already exists but needs an extra field, use "update_content_type" instead of recreating it.
- To link two entities together (e.g. a task relates to a goal), use "link_entities".
- To add tags to an existing entity, use the add_tag_* nodes (e.g. add_tag_task).
- To set entity-specific fields (startDate, endDate, priority, location, email, etc.) when creating entities, ALSO select "set_context_value" — you'll need it to put field values into context before the create node.

When the user's request implies creating entities, ALWAYS select the appropriate create_* nodes.
CRITICAL: Match the entity type precisely. An "event" is NOT a "task" — use create_event for events/appointments/meetings and create_task for todos/action items. Each entity type exists for a reason; never substitute one for another.
When the user mentions multiple entities, select multiple create_* nodes.
When the user refers to a content type that doesn't exist yet, select "create_content_type".

Here are all available catalog nodes in the Feral process engine. Each node performs a specific action:
${relevanceHintBlock}
${catalogSummary}

IMPORTANT RULES:
- Every process MUST start with "start" and end with "stop"
- Always include "start" and "stop" in your selection
- The "llm_chat" node sends a prompt to an LLM. It supports {context_key} interpolation in prompts
- Only select nodes that are directly useful for fulfilling the user's request
- Prefer entity nodes (list_*, find_*, create_*, complete_*) for data operations — act, don't just advise
- Prefer system nodes (get_time, get_date, etc.) for system information
- When the user wants to CREATE something, use the create_* nodes — don't just use llm_chat to give advice
- When the user wants to mark something as done/complete, use complete_* nodes (e.g. complete_task)
- When the user asks about entities by tag, use list_* or search_* with the "tags" config
- When the user mentions a content type that doesn't exist, select "create_content_type"
- When the user wants to relate or connect entities, select "link_entities"
- PROACTIVELY link related entities when the context makes the connection clear (e.g. user says "add a task for my goal X" → create task AND link it to the goal)
- Consider the "About You" section in vault context — use it to personalise responses and infer intent
- When creating an entity, prefer ACTION over QUESTIONS. Use sensible defaults for missing optional fields (e.g. use today's date if no date specified, use "medium" priority if not stated). Only select "prompt_input" or "prompt_select" when: (a) the user explicitly asks for help choosing, or (b) a required field has no reasonable default AND the user gave ambiguous info. One question max per request — never chain multiple prompts.

Return a JSON object with this exact structure:
{
    "reasoning": "Why these nodes were selected",
    "nodes": ["start", "stop", "node_key_1", "node_key_2"]
}

Return ONLY the JSON object, no markdown fences.`,
        }],
        {
            systemPrompt: 'You are the reasoning engine for Phaibel, a Personal Digital Agent. It manages a vault of linked content (tasks, events, notes, goals, people, etc.) stored as Markdown files. Content can be linked in a knowledge graph. Your job is to select the minimal set of catalog nodes to fulfill the user\'s request. Always include "start" and "stop". Prefer creating concrete entities over giving advice. Look for opportunities to link related content.',
            temperature: 0.3,
        },
    );

    debug('chat', `Step 1 response: ${step1Response}`);

    let nodeSelection: { reasoning: string; nodes: string[] };
    try {
        nodeSelection = parseJsonResponse(step1Response) as { reasoning: string; nodes: string[] };
    } catch (err) {
        debug('chat', `Step 1 raw response: ${step1Response}`);
        throw new Error(`Failed to parse node selection from LLM: ${err instanceof Error ? err.message : err}`);
    }

    await logger.log('node_selection', { reasoning: nodeSelection.reasoning, nodes: nodeSelection.nodes });

    // Ensure start/stop are included
    if (!nodeSelection.nodes.includes('start')) nodeSelection.nodes.unshift('start');
    if (!nodeSelection.nodes.includes('stop')) nodeSelection.nodes.push('stop');

    // Gather selected node details + their config descriptions
    const selectedNodes = nodeSelection.nodes
        .map(key => {
            try {
                return runtime.catalog.getCatalogNode(key);
            } catch {
                return null;
            }
        })
        .filter(Boolean);

    const selectedNodeDetails = selectedNodes
        .map(n => {
            const config = Object.keys(n!.configuration).length > 0
                ? `  config: ${JSON.stringify(n!.configuration)}`
                : '';
            return `- ${n!.key} (${n!.group}): ${n!.description || n!.name}${config}`;
        })
        .join('\n');

    // Get config descriptions for the selected node codes
    const nodeCodeDetails: string[] = [];
    for (const n of selectedNodes) {
        if (!n) continue;
        try {
            const nodeCode = runtime.nodeCodeFactory.getNodeCode(n.nodeCodeKey);
            const Ctor = nodeCode.constructor as { configDescriptions?: Array<{ key: string; name: string; description: string; type: string; default?: unknown; isOptional?: boolean; isSecret?: boolean }> };
            const Ctor2 = nodeCode.constructor as { resultDescriptions?: Array<{ status: string; description: string }> };
            // Filter out secret config keys — they should never appear in LLM prompts
            const configs = (Ctor.configDescriptions ?? []).filter(c => !c.isSecret);
            const results = Ctor2.resultDescriptions ?? [];
            if (configs.length > 0 || results.length > 0) {
                const configStr = configs.map(c =>
                    `    - ${c.key} (${c.type}${c.isOptional ? ', optional' : ''}${c.default != null ? `, default: ${JSON.stringify(c.default)}` : ''}): ${c.description}`
                ).join('\n');
                const resultStr = results.map(r => `    → "${r.status}": ${r.description}`).join('\n');
                nodeCodeDetails.push(`${n.key} (nodeCode: ${n.nodeCodeKey}):\n  Configuration:\n${configStr}\n  Results (edge keys):\n${resultStr}`);
            }
        } catch {
            // Skip if node code not found
        }
    }

    // ── STEP 1.5: Information gathering (skipped in headless mode) ──
    // In headless mode we don't prompt for follow-ups — proceed with what we have
    const gatheredInfoStr = '';

    // ── Expand context tree with entity types referenced by selected nodes ──
    // When find_*, link_*, update_*, complete_*, set_* nodes are selected,
    // the LLM needs leaf data for those types to avoid hallucinating titles.
    const refNodePattern = /^(find_|link_|update_|complete_|set_|add_tag_|search_)/;
    const additionalTypes: string[] = [];
    for (const key of nodeSelection.nodes) {
        if (refNodePattern.test(key)) {
            const parts = key.split('_');
            if (key === 'link_entities') {
                for (const et of entityTypes) {
                    if (!contextTree.branches.some(b => b.entityType === et.name && b.leaves.length > 0)) {
                        additionalTypes.push(et.name);
                    }
                }
            } else if (parts.length >= 2) {
                const typeName = parts.slice(1).join('_');
                const match = entityTypes.find(et => et.name === typeName || et.plural === typeName);
                if (match && !contextTree.branches.some(b => b.entityType === match.name && b.leaves.length > 0)) {
                    additionalTypes.push(match.name);
                }
            }
        }
    }
    if (additionalTypes.length > 0) {
        await expandContextTree(contextTree, additionalTypes);
        contextTreeStr = serializeContextTree(contextTree);
    }

    // ── ORCHESTRATION LOOP ────────────────────────────────────────────
    // Iteratively: generate process → run → check completion → repeat
    const MAX_ITERATIONS = 3;
    const allResults: Record<string, unknown>[] = [];
    const allReasonings: string[] = [];
    const allProcessKeys: string[] = [];
    let remainingWork = userInput;

    const examplesStr = EXAMPLE_PROCESSES.map((ex, i) =>
        `Example ${i + 1}: ${ex.description}\n${JSON.stringify(ex.json, null, 2)}`
    ).join('\n\n');

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        // ── STEP 2: Generate process ─────────────────────────────────
        status(`Designing process${iteration > 0 ? ` (step ${iteration + 1})` : ''}…`);

        const previousResultsStr = allResults.length > 0
            ? `\n\nRESULTS FROM PREVIOUS STEPS:\n${JSON.stringify(allResults, null, 2)}`
            : '';

        const step2Response = await llm.chat(
            [{
                role: 'user' as const,
                content: `Build a Feral process to handle: "${remainingWork}"
${historyBlock}${gatheredInfoStr}${previousResultsStr}
${contextTreeStr}

SELECTED CATALOG NODES (you must only use nodes from this list):
${selectedNodeDetails}

NODE CONFIGURATION DETAILS:
${nodeCodeDetails.join('\n\n')}

PROCESS FORMAT RULES:
1. schema_version=1, key="chat.generated". First node: key="start", catalog_node_key="start". Last node: key="done", catalog_node_key="stop", edges={}.
2. "edges" maps result statuses to next node key. Most nodes produce "ok" and "error". Use {context_key} for interpolation.
3. Context starts with user_input="${userInput}". Keep processes simple — fewer nodes is better.
4. For entity creation, ALWAYS set entity_title and entity_body with concrete values.
5. create_* nodes ONLY accept: entity_type, entity_title, entity_body, tags, extra_fields. To set fields (startDate, priority, etc.): put values in process "context" object, list field names in extra_fields. For multi-entity with different field values, use set_context_value nodes between creates.
6. DATE FORMAT: date→YYYY-MM-DD, datetime→ISO 8601 with timezone (e.g. "2026-03-25T14:00:00-06:00"). Events ALWAYS need BOTH startDate AND endDate in context+extra_fields. Default to 09:00-10:00 if no time given.
7. CRITICAL: Match entity types precisely. event≠task. Use create_event for appointments/meetings, create_task for todos. Never substitute types.
8. When referencing existing entities, use EXACT titles from CONTEXT TREE. Use valid enum values only.
9. Prefer ACTION over QUESTIONS. Use sensible defaults (today's date, "medium" priority). Max one prompt node per process.
10. If create_content_type is in your node list, you MUST use it. Create type FIRST, then create_entity. Don't use "note" as a generic bucket.
11. Multiple create_entity nodes of same type work correctly — don't worry about context key collisions.
12. For search_* nodes, set "query" in config. For MCP skill nodes, put tool parameters directly in config.

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
                systemPrompt: 'You are the process designer for Phaibel, a Personal Digital Agent that manages a vault of linked content. Generate a valid process JSON that solves the user\'s request using the provided catalog nodes. The process executes immediately — create real entities, set real values, link real content. Be precise with catalog_node_key values — they must match exactly. Prefer action over advice.',
                temperature: 0.3,
                maxTokens: 16384,
            },
        );

        debug('chat', `Step 2 response (iteration ${iteration + 1}): ${step2Response}`);

        let processDesign: { reasoning: string; process: Record<string, unknown> };
        try {
            processDesign = parseJsonResponse(step2Response) as { reasoning: string; process: Record<string, unknown> };
        } catch (err) {
            debug('chat', `Step 2 raw response: ${step2Response}`);
            throw new Error(`Failed to parse process design from LLM: ${err instanceof Error ? err.message : err}`);
        }

        allReasonings.push(processDesign.reasoning);

        await logger.log('process_design', { iteration: iteration + 1, reasoning: processDesign.reasoning, process: processDesign.process });

        // Emit process JSON for visualization
        onProcess?.(processDesign.process);

        // Detect duplicate process — if the LLM generated the same process
        // as a previous iteration, it's looping and we should stop
        const processFingerprint = JSON.stringify(processDesign.process);
        if (allProcessKeys.includes(processFingerprint)) {
            debug('chat', `Duplicate process detected at iteration ${iteration + 1}, breaking loop`);
            break;
        }
        allProcessKeys.push(processFingerprint);

        // ── STEP 3: Execute the generated process ────────────────────
        status(`Running process${iteration > 0 ? ` (step ${iteration + 1})` : ''}…`);

        let processJsonStr: string;
        try {
            processJsonStr = JSON.stringify(processDesign.process);
        } catch {
            throw new Error('Generated process is not valid JSON');
        }

        const process = hydrateProcessFromString(processJsonStr);
        runtime.processFactory.invalidate(process.key);
        runtime.engine.clearCache();
        inMemorySource.add(process);

        let contextResult: Record<string, unknown>;
        try {
            // Merge process-level context values (e.g. field values for extra_fields)
            const processContext = (processDesign.process.context ?? {}) as Record<string, unknown>;
            const ctx = await runtime.runner.run(process.key, {
                ...processContext,
                user_input: userInput,
                ...(onQuestion ? { _askQuestion: onQuestion } : {}),
            });
            contextResult = ctx.getAll();
        } catch (error) {
            debug('chat', `Process execution failed: ${error instanceof Error ? error.stack ?? error.message : error}`);
            contextResult = { _error: error instanceof Error ? error.message : String(error) };
        }

        // Filter internal keys and scrub any secrets from context results
        // Keep 'error' and '_error' visible so completion checker knows about failures
        const iterationResult = Object.entries(contextResult)
            .filter(([k]) => k === '_error' || (!k.startsWith('_') && k !== 'user_input'))
            .reduce((acc, [k, v]) => {
                acc[k] = typeof v === 'string' && v.length > 2000 ? v.slice(0, 2000) + '…' : v;
                return acc;
            }, {} as Record<string, unknown>);

        allResults.push(scrubSecrets(iterationResult) as Record<string, unknown>);

        await logger.log('process_result', { iteration: iteration + 1, results: iterationResult });

        // ── STEP 4: Check completion ──────────────────────────────────
        if (iteration < MAX_ITERATIONS - 1) {
            status('Checking if task is complete…');

            const completionResponse = await llm.chat(
                [{
                    role: 'user' as const,
                    content: `The user originally said: "${userInput}"

We have completed ${iteration + 1} step(s) so far.

Step reasoning: ${allReasonings.join(' → ')}

Results from all steps:
${JSON.stringify(allResults, null, 2)}

Is the user's request fulfilled? Consider:
- Did we create the entity/entities the user explicitly asked for?
- If the user asked for multiple DISTINCT actions (e.g., "create a task AND a note"), were all done?

IMPORTANT rules for deciding:
- Check the "created_entities" array in the results — it accumulates ALL entities created across all nodes in the process, even when individual context keys get overwritten.
- Check the "created_entity_types" array — it shows all new types that were registered.
- If an entity was successfully created, the request is COMPLETE — do NOT retry because of minor details like metadata formatting.
- Do NOT request "more work" for implementation details (e.g., how a blackout window is stored, or whether a field was set in exactly the right way).
- Do NOT request "more work" to link entities — linking is nice-to-have, not required.
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

            debug('chat', `Completion check (iteration ${iteration + 1}): ${completionResponse}`);

            let completion: { status: string; remaining?: string };
            try {
                completion = parseJsonResponse(completionResponse) as { status: string; remaining?: string };
            } catch {
                debug('chat', 'Could not parse completion response, assuming complete');
                break;
            }

            await logger.log('completion_check', { iteration: iteration + 1, status: completion.status, remaining: completion.remaining || null });

            if (completion.status === 'complete') {
                debug('chat', 'Task complete, exiting orchestration loop');
                break;
            }

            // Update the remaining work for the next iteration
            remainingWork = completion.remaining || userInput;
            debug('chat', `More work needed: ${remainingWork}`);
        }
    }

    // ── STEP 5: Synthesize response ──────────────────────────────────
    status('Composing response…');

    const nodesUsed = selectedNodes
        .filter(Boolean)
        .map(n => `- ${n!.key}: ${n!.description || n!.name}`);

    const finalResponse = await synthesizeResponse(
        llm, userInput, nodeSelection.reasoning,
        allResults, nodesUsed, vaultContext, history, chatId,
    );
    await logger.log('response', { response: finalResponse });

    // Fire-and-forget execution log
    const lastProcessDesign = allReasonings.length > 0
        ? { reasoning: allReasonings, iterations: allReasonings.length }
        : {};
    writeExecutionLog({
        timestamp: new Date().toISOString(),
        chat_id: chatId,
        user_input: userInput,
        process_source: 'custom',
        process_key: 'chat.generated',
        process_json: lastProcessDesign,
        context_result: allResults.length > 0 ? allResults[allResults.length - 1] : {},
        success: !allResults.some(r => r._error),
        outcome_summary: finalResponse.slice(0, 500),
        iterations: allReasonings.length,
    }).catch(err => debug('chat', `Execution log write failed: ${err}`));

    return finalResponse;
}

// ─────────────────────────────────────────────────────────────────────────────
// SYNTHESIS HELPER
// ─────────────────────────────────────────────────────────────────────────────

async function synthesizeResponse(
    llm: LLMProvider,
    userInput: string,
    reasoning: string,
    results: Record<string, unknown>[],
    nodesUsed: string[],
    vaultContext: string,
    history: ChatHistoryEntry[] = [],
    chatId?: string,
): Promise<string> {
    const synthesisPrompt = `The user said: "${userInput}"
${formatHistoryBlock(history)}
WHAT WAS DONE:
Reasoning: ${reasoning}

${results.length} process step(s) executed.

${nodesUsed.length > 0 ? `Nodes used:\n${nodesUsed.join('\n')}\n` : ''}Results:
${JSON.stringify(results, null, 2)}

${results.some(r => r._error) ? `Note: Some steps encountered errors.` : ''}

RESPONSE GUIDELINES:
- Summarise what was done concretely (created X, linked Y to Z, completed W)
- If entities were created or updated, name them so the user can find them
- If entities were linked, mention the relationship
- Keep it concise — a few sentences, not paragraphs
- If there were errors, acknowledge honestly and suggest alternatives
- If the results suggest follow-up actions, briefly mention them

PERSONALITY OBSERVATION (Big Five — include with every response):
After composing your response, rate BOTH the user and yourself on these 5 traits (1-5 scale) based on THIS interaction only. Observe the user's communication style, requests, and behavior. Observe your own response style.
- extraversion (1=reserved/brief, 5=outgoing/elaborate)
- conscientiousness (1=casual/loose, 5=disciplined/precise)
- agreeableness (1=challenging/direct, 5=cooperative/accommodating)
- openness (1=routine/practical, 5=exploratory/creative)
- emotionalStability (1=tense/reactive, 5=calm/composed)

ASSUMED CONTEXT NODES:
If the user casually mentions people, places, projects, or other notable entities that don't already exist in context, include them in "assumed_nodes" so they can be saved automatically. Only include entities that are clearly worth remembering — not throwaway mentions. Each assumed node needs: contextType (must match an available type like "person", "note", etc.), title, and any fields you can infer.

You MUST return valid JSON with this structure:
{
    "response": "Your natural response to the user (markdown ok)",
    "personality_observation": {
        "user": { "extraversion": 3, "conscientiousness": 3, "agreeableness": 3, "openness": 3, "emotionalStability": 3 },
        "robot": { "extraversion": 3, "conscientiousness": 3, "agreeableness": 3, "openness": 3, "emotionalStability": 3 }
    },
    "assumed_nodes": []
}`;

    const rawResponse = await llm.chat(
        [{ role: 'user' as const, content: synthesisPrompt }],
        {
            systemPrompt: createSystemPrompt(vaultContext || ''),
            temperature: 0.7,
        },
    );

    // Try to parse structured JSON response with personality scores
    let responseText: string;
    try {
        const parsed = parseJsonResponse(rawResponse);
        responseText = (parsed.response as string) || rawResponse.trim();

        // Extract and store personality observation (fire-and-forget)
        const obs = parsed.personality_observation as Record<string, unknown> | undefined;
        if (obs) {
            const userScores = validateScores(obs.user);
            const robotScores = validateScores(obs.robot);
            if (userScores && robotScores) {
                const sample: BigFiveSample = {
                    timestamp: new Date().toISOString(),
                    chatId: chatId || 'unknown',
                    user: userScores,
                    robot: robotScores,
                };
                updateProfile(sample).then(() => invalidateProfileCache()).catch(() => {});
            }
        }
        // Extract and create assumed context nodes (fire-and-forget)
        const assumedNodes = parsed.assumed_nodes as Array<{ contextType: string; title: string; [key: string]: unknown }> | undefined;
        if (assumedNodes && assumedNodes.length > 0) {
            createAssumedNodes(assumedNodes).catch(err => debug('chat', `Assumed node creation failed: ${err}`));
        }
    } catch {
        // Fallback: LLM returned plain text — use as-is, skip scoring
        responseText = rawResponse.trim();
        debug('chat', 'Synthesis returned plain text — personality scoring skipped');
    }

    // Post-message judge — fire-and-forget alongside personality update
    if (chatId) {
        judgeResponse(userInput, responseText, chatId).catch(() => {});
    }

    return responseText;
}

/**
 * Create assumed context nodes that the LLM inferred from conversation.
 * These are lightweight nodes with source: "assumed".
 */
async function createAssumedNodes(
    nodes: Array<{ contextType: string; title: string; [key: string]: unknown }>,
): Promise<void> {
    for (const node of nodes) {
        if (!node.contextType || !node.title) continue;

        const typeConfig = await getEntityType(node.contextType);
        if (!typeConfig) {
            debug('chat', `Assumed node skipped — unknown type: ${node.contextType}`);
            continue;
        }

        const id = generateNodeId();
        const now = new Date().toISOString();
        const meta: Record<string, unknown> = {
            id,
            title: node.title,
            entityType: node.contextType,
            contextType: node.contextType,
            created: now,
            tags: (node.tags as string[]) || typeConfig.defaultTags || [],
            source: 'assumed',
        };

        // Copy type-specific fields from the assumed node
        for (const field of typeConfig.fields) {
            if (node[field.key] !== undefined) {
                meta[field.key] = node[field.key];
            } else if (field.default !== undefined) {
                meta[field.key] = field.default;
            }
        }

        try {
            const dir = await ensureEntityDir(node.contextType);
            const filename = nodeFilename(node.title, id);
            const filepath = `${dir}/${filename}`;
            await writeEntity(filepath, meta, '');
            debug('chat', `Created assumed node: ${node.contextType}/${node.title} (${id})`);
        } catch (err) {
            debug('chat', `Failed to create assumed node "${node.title}": ${err}`);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST-MESSAGE JUDGE — evaluates if the response achieved the user's needs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget judge that evaluates response quality.
 * Uses a fast/cheap model (categorize capability) to avoid adding cost.
 */
async function judgeResponse(
    userInput: string,
    responseText: string,
    chatId: string,
): Promise<void> {
    try {
        const judge = await getModelForCapability('categorize');
        const raw = await judge.chat(
            [{
                role: 'user' as const,
                content: `You are a response quality judge. Evaluate whether the assistant's response achieved what the user needed.

USER REQUEST:
${userInput}

ASSISTANT RESPONSE:
${responseText}

Rate the response. Return JSON only:
{
    "achieved": true/false,
    "confidence": 0.0-1.0,
    "reasoning": "one sentence why"
}`,
            }],
            { temperature: 0 },
        );

        const parsed = parseJsonResponse(raw);
        await appendJudgement(chatId, {
            achieved: Boolean(parsed.achieved),
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
            reasoning: String(parsed.reasoning || ''),
        });
        debug('judge', `${chatId}: achieved=${parsed.achieved} confidence=${parsed.confidence}`);
    } catch (err) {
        debug('judge', `Failed: ${err}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

// Patterns that look like API keys / tokens — redact before sending to LLM
const SECRET_PATTERNS = [
    /sk-[a-zA-Z0-9_-]{20,}/g,          // OpenAI keys
    /sk-ant-[a-zA-Z0-9_-]{20,}/g,      // Anthropic keys
    /ghp_[a-zA-Z0-9]{36,}/g,           // GitHub PATs
    /ghu_[a-zA-Z0-9]{36,}/g,           // GitHub user tokens
    /xox[bsarp]-[a-zA-Z0-9\-]{10,}/g,  // Slack tokens
];

const SECRET_KEYS = new Set([
    'apiKey', 'api_key', 'apikey',
    'secret', 'token', 'password',
    'authorization', 'credential',
]);

/**
 * Deep-scrub secret-shaped values from an object before it's sent to an LLM.
 */
function scrubSecrets(obj: unknown): unknown {
    if (typeof obj === 'string') {
        let s = obj;
        for (const pat of SECRET_PATTERNS) {
            s = s.replace(pat, '[REDACTED]');
        }
        return s;
    }
    if (Array.isArray(obj)) {
        return obj.map(scrubSecrets);
    }
    if (obj && typeof obj === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj)) {
            if (SECRET_KEYS.has(k.toLowerCase())) {
                out[k] = '[REDACTED]';
            } else {
                out[k] = scrubSecrets(v);
            }
        }
        return out;
    }
    return obj;
}


/**
 * Ask a follow-up question using inquirer.
 * Inquirer manages its own stdin/stdout lifecycle, avoiding conflicts
 * with the shell's paused readline interface.
 */
async function askFollowUp(question: string): Promise<string> {
    const { answer } = await inquirer.prompt([{
        type: 'input',
        name: 'answer',
        message: question,
    }]);
    return answer as string;
}
