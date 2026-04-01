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
import { bootstrapFeral } from '../feral/bootstrap.js';
import { hydrateProcessFromString } from '../feral/process/process-json-hydrator.js';
import type { ProcessSource } from '../feral/process/process-factory.js';
import type { Process } from '../feral/process/process.js';
import { getModelForCapability, createSystemPrompt } from '../llm/router.js';
import { debug } from '../utils/debug.js';
import { ChatLogger, generateChatId } from '../utils/chat-logger.js';
import { parseJsonResponse } from '../utils/json-parser.js';
import { writeExecutionLog } from '../utils/execution-logger.js';
import { loadEntityTypes } from '../entities/entity-type-config.js';
import { getUserName } from '../state/manager.js';
import { getVaultContext } from '../context/reader.js';
import { getEntityIndex } from '../entities/entity-index.js';
import { buildContextTree, expandContextTree } from '../context/context-tree.js';
import { serializeContextTree } from '../context/context-tree-serializer.js';
import { classifyScope } from '../context/scope-classifier.js';
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
        description: 'Simple linear process: list tasks then sort them',
        json: {
            schema_version: 1,
            key: 'tasks.list',
            description: 'List all tasks, sorted by priority and due date',
            context: {},
            nodes: [
                { key: 'start', catalog_node_key: 'start', configuration: {}, edges: { ok: 'list' } },
                { key: 'list', catalog_node_key: 'list_tasks', configuration: {}, edges: { ok: 'sort' } },
                { key: 'sort', catalog_node_key: 'sort_tasks', configuration: {}, edges: { ok: 'done' } },
                { key: 'done', catalog_node_key: 'stop', configuration: {}, edges: {} },
            ],
        },
    },
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
        description: 'If/else branch: find a task, check its priority, and take different actions based on whether it is high priority',
        json: {
            schema_version: 1,
            key: 'task.priority.check',
            description: 'Find a task by title, then branch on its priority — set high-priority tasks to in-progress, leave others as-is',
            context: {},
            nodes: [
                { key: 'start', catalog_node_key: 'start', configuration: {}, edges: { ok: 'find' } },
                { key: 'find', catalog_node_key: 'find_task', configuration: {}, edges: { ok: 'check_priority', error: 'done' } },
                { key: 'check_priority', catalog_node_key: 'context_value_comparator', configuration: { left_context_path: 'priority', right_value: 'high' }, edges: { true: 'set_in_progress', false: 'done' } },
                { key: 'set_in_progress', catalog_node_key: 'set_task_status', configuration: { value: 'in-progress' }, edges: { ok: 'done', error: 'done' } },
                { key: 'done', catalog_node_key: 'stop', configuration: {}, edges: {} },
            ],
        },
    },
    {
        description: 'Tag filter: list only tasks that have a specific tag',
        json: {
            schema_version: 1,
            key: 'tasks.by_tag',
            description: 'List all tasks with the "home" tag',
            context: {},
            nodes: [
                { key: 'start', catalog_node_key: 'start', configuration: {}, edges: { ok: 'list' } },
                { key: 'list', catalog_node_key: 'list_tasks', configuration: { tags: 'home' }, edges: { ok: 'done' } },
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
        description: 'Link two entities: connect a task to a goal',
        json: {
            schema_version: 1,
            key: 'link.task_to_goal',
            description: 'Link a task to a related goal',
            context: {},
            nodes: [
                { key: 'start', catalog_node_key: 'start', configuration: {}, edges: { ok: 'link' } },
                { key: 'link', catalog_node_key: 'link_entities', configuration: { source_entity_type: 'task', source_entity_title: 'Fix the fence', target_entity_type: 'goal', target_entity_title: 'Home improvement', label: 'contributes-to' }, edges: { ok: 'done', not_found: 'done', error: 'done' } },
                { key: 'done', catalog_node_key: 'stop', configuration: {}, edges: {} },
            ],
        },
    },
    {
        description: 'Create a new content type for something not yet tracked',
        json: {
            schema_version: 1,
            key: 'type.create',
            description: 'Create a recipe content type',
            context: {},
            nodes: [
                { key: 'start', catalog_node_key: 'start', configuration: {}, edges: { ok: 'create_type' } },
                { key: 'create_type', catalog_node_key: 'create_content_type', configuration: { type_name: 'recipe', description: 'A cooking recipe with ingredients, instructions, prep time, and servings' }, edges: { ok: 'done', already_exists: 'done', error: 'done' } },
                { key: 'done', catalog_node_key: 'stop', configuration: {}, edges: {} },
            ],
        },
    },
    {
        description: 'Create an event with fields set via initial context (no set_context_value nodes needed)',
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
        description: 'While loop: list tasks, iterate over each one, and use LLM to add a summary to each task body',
        json: {
            schema_version: 1,
            key: 'tasks.summarize',
            description: 'Loop through all tasks and ask the LLM to generate a one-line summary for each',
            context: {},
            nodes: [
                { key: 'start', catalog_node_key: 'start', configuration: {}, edges: { ok: 'list' } },
                { key: 'list', catalog_node_key: 'list_tasks', configuration: {}, edges: { ok: 'iterate' } },
                { key: 'iterate', catalog_node_key: 'array_iterator', configuration: { source_context_path: 'entities', cursor_context_path: '_cursor', spread_fields: 'true' }, edges: { ok: 'summarize', done: 'done' } },
                { key: 'summarize', catalog_node_key: 'llm_chat', configuration: { capability: 'summarize', prompt: 'Write a one-line summary for a task titled "{title}".', response_context_path: 'summary' }, edges: { ok: 'iterate', error: 'iterate' } },
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
): Promise<string> {
    const status = (s: string) => onStatus?.(s);
    const chatId = generateChatId();
    const logger = new ChatLogger(chatId);

    // Fire the chat ID callback immediately so callers can display/send it
    onChatId?.(chatId);

    status('Thinking…');

    try { return await _feralChatHeadlessInner(userInput, status, onProcess, onQuestion, logger, chatId, history ?? []); }
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
): Promise<string> {
    // ── Bootstrap Feral + load entity types + vault context ────────
    const inMemorySource = new InMemoryProcessSource();
    const [runtime, entityTypes, userName] = await Promise.all([
        bootstrapFeral([inMemorySource]),
        loadEntityTypes().catch(() => []),
        getUserName().catch(() => 'friend'),
    ]);

    await logger.log('start', { chatId, userInput });

    // Load vault context (.vault.md chain)
    // Scrub any secrets that may have been accidentally pasted into .vault.md files
    const vaultContext = scrubSecrets(await getVaultContext().catch(() => '')) as string;

    // Build global variables block for the LLM
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    // Detect user timezone from system (e.g. "America/Denver", "UTC")
    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Compute UTC offset string (e.g. "-06:00")
    const tzOffset = (() => {
        const off = now.getTimezoneOffset(); // minutes, positive = west of UTC
        const sign = off <= 0 ? '+' : '-';
        const h = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
        const m = String(Math.abs(off) % 60).padStart(2, '0');
        return `${sign}${h}:${m}`;
    })();
    const globalsBlock = [
        `- user_name: ${userName}`,
        `- current_date: ${today}`,
        `- user_timezone: ${userTimezone} (UTC${tzOffset})`,
    ].join('\n');

    // ── Build context tree ───────────────────────────────────────────
    const entityIndex = getEntityIndex();
    if (!entityIndex.isBuilt) await entityIndex.build();

    const globalsMap: Record<string, string> = {
        user_name: userName,
        current_date: today,
        user_timezone: `${userTimezone} (UTC${tzOffset})`,
    };
    const scope = classifyScope(userInput, entityTypes, entityIndex.getStats());
    const contextTree = await buildContextTree(scope, globalsMap);
    let contextTreeStr = serializeContextTree(contextTree);

    debug('chat', `Context tree: scope=${scope.type}, tokens≈${Math.ceil(contextTreeStr.length / 4)}`);

    const allNodes = runtime.catalog.getAllCatalogNodes();

    // Build catalog summary for LLM
    const catalogSummary = allNodes
        .filter(n => !n.key.startsWith('speak_'))  // skip output variants
        .map(n => `- ${n.key}: ${n.description || n.name} [group: ${n.group}]`)
        .join('\n');

    debug('chat', `Catalog has ${allNodes.length} nodes, sending ${catalogSummary.split('\n').length} to LLM`);

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
                    [scrubbedResult], [], vaultContext, history,
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
1. schema_version MUST be 1
2. key should be "chat.generated"
3. First node MUST have key "start" with catalog_node_key "start"
4. Last node MUST have key "done" with catalog_node_key "stop" and empty edges {}
5. "edges" maps result status strings to the next node key
6. Most nodes produce "ok" and "error" results
7. Use {context_key} syntax in configuration values to interpolate context values
8. The context starts with: user_input = "${userInput}"
9. Keep the process as simple as possible — prefer fewer nodes
10. For entity creation, ALWAYS set entity_title and entity_body in the configuration with concrete values
11. Use the vault context to inform entity content — respect project goals and conventions
12. To filter by tag, set "tags" in configuration (comma-separated), e.g. { "tags": "year-of-the-house" }
13. To link entities, use link_entities with source_entity_type, source_entity_title, target_entity_type, target_entity_title, and label
14. To complete/finish an entity, use the complete_* catalog node (e.g. complete_task)
15. ONLY use configuration keys that appear in the NODE CONFIGURATION DETAILS above — do not invent keys. The create_* nodes ONLY accept: entity_type, entity_title, entity_body, tags, extra_fields. Do NOT put field names like startDate, priority, status, location directly in configuration.
16. To set entity-specific fields (e.g. startDate, endDate, priority, status, location, email): For single-entity processes, put field values in the process "context" object and list field names in extra_fields. Example: "context": { "startDate": "2026-03-25T14:00:00-06:00", "endDate": "2026-03-25T15:00:00-06:00", "location": "Office" } with extra_fields: "startDate,endDate,location". For multi-entity processes where different entities need different values for the same field (e.g. task status="open" vs goal status="active"), use set_context_value nodes between the create nodes to change the value. DATE FORMAT RULES: date fields → YYYY-MM-DD, datetime fields → ISO 8601 with timezone offset. The set_context_value config keys are: "context_path" (the field name), "value" (the value), and "value_type" (REQUIRED for date/datetime).
17. When referencing existing entities (find_*, link_*, update_*, complete_*, set_*), use EXACT titles from the entity leaves in the CONTEXT TREE — do NOT guess or paraphrase entity titles
18. CRITICAL: Use the correct entity type catalog node. An event (appointment, meeting, scheduled activity) MUST use create_event, NOT create_task. A task (action item, todo) MUST use create_task, NOT create_event. Never substitute one entity type for another.
19. When setting enum fields (in context object or via set_context_value), use ONLY the valid values from the ENTITY TYPES schema above. For example, task status must be one of [open, in-progress, done, blocked] — do NOT use "todo", "complete", or other values. If unsure, omit the field and let the default apply.
20. Events ALWAYS require BOTH startDate AND endDate (both are datetime type). Use ISO 8601 with timezone offset: "YYYY-MM-DDTHH:mm:ssZ" (e.g. "2026-03-25T14:00:00-06:00"). If the user doesn't mention a time, default to 09:00 start and 10:00 end in their timezone. If the user only mentions one date, set endDate to 1 hour after startDate. Put both in the process context object and include both in extra_fields: "startDate,endDate".
21. Prefer ACTION over QUESTIONS. Use sensible defaults for missing fields (today's date, "medium" priority, etc.) rather than asking. Only use prompt_input/prompt_select when the user explicitly asks for help choosing OR a required field truly cannot be inferred. Never chain multiple prompt nodes — one question max per process. If you must ask, wire the prompt node's "ok" edge to the create node so the answer flows into context.

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
            const ctx = await runtime.runner.run(process.key, {
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
        allResults, nodesUsed, vaultContext, history,
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
- If the results suggest follow-up actions, briefly mention them`;

    const response = await llm.chat(
        [{ role: 'user' as const, content: synthesisPrompt }],
        {
            systemPrompt: createSystemPrompt(vaultContext || ''),
            temperature: 0.7,
        },
    );

    return response.trim();
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
