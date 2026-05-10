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
import { getCapabilityModel } from '../config.js';
import { debug } from '../utils/debug.js';
import { ChatLogger, generateChatId, appendJudgement } from '../utils/chat-logger.js';
import { parseJsonResponse } from '../utils/json-parser.js';
import { writeExecutionLog } from '../utils/execution-logger.js';
import { loadEntityTypes } from '../entities/entity-type-config.js';
import { getUserName } from '../state/manager.js';
import { getVaultContext } from '../context/reader.js';
import { getEntityIndex } from '../entities/entity-index.js';
import { analyzeQueryRelevance, filterCatalogNodes } from '../context/query-relevance.js';
import type { RelevantType } from '../context/query-relevance.js';
import { buildMomentContext, momentToGlobals } from '../context/moment.js';
import { updateProfile, validateScores, invalidateProfileCache, type BigFiveSample } from '../personality/big-five.js';
import { generateNodeId, ensureEntityDir, writeEntity, nodeFilename } from '../entities/entity.js';
import { getEntityType } from '../entities/entity-type-config.js';
import { classifyIntent } from '../context/intent-classifier.js';
import { buildContextManifest } from '../context/context-manifest.js';
import { runContextLoop, serializeGatheredContext } from '../context/context-loop.js';
import { resolveTokens, TOKEN_INSTRUCTIONS } from '../utils/token-resolver.js';
import { UI_COMPONENT_INSTRUCTIONS } from '../utils/ui-components.js';
import type { LLMProvider } from '../llm/types.js';
import { runWithTokenTracker, type ChatTokenTotals } from '../llm/token-usage.js';
import { getContextWindowTokens } from '../config.js';

// ─────────────────────────────────────────────────────────────────────────────
// RESULTS COMPACTION
// Trims entity arrays in process results before injecting into LLM prompts.
// Prevents context window overflow on listing queries (e.g. "what events do you know about?").
// Budget: allow up to 40% of the model's context window for results (chars ≈ tokens * 4).
// ─────────────────────────────────────────────────────────────────────────────

const TODAY_MS = () => Date.now();
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function compactResultsForPrompt(results: Record<string, unknown>[], modelName: string): string {
    const windowTokens = getContextWindowTokens(modelName);
    const budgetChars = windowTokens * 4 * 0.40; // 40% of context in chars

    const full = JSON.stringify(results, null, 2);
    if (full.length <= budgetChars) return full;

    // Over budget — compact entity arrays: replace with count + highlights
    const now = TODAY_MS();
    const compacted = results.map(r => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) {
            if (Array.isArray(v) && v.length > 0 && v[0] !== null && typeof v[0] === 'object') {
                const arr = v as Record<string, unknown>[];
                // Sort by first ISO date field found, keep next-7-days first then rest
                const withDate = arr.map(item => {
                    const dateStr = Object.values(item).find(
                        x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x as string)
                    ) as string | undefined;
                    return { item, ts: dateStr ? new Date(dateStr).getTime() : Infinity };
                });
                withDate.sort((a, b) => a.ts - b.ts);
                const highlights = withDate
                    .filter(x => x.ts === Infinity || x.ts >= now - 86_400_000) // today onward + undated
                    .slice(0, 20)
                    .map(x => {
                        // Strip content/body fields to keep highlights lean
                        const { content: _c, body: _b, ...rest } = x.item as Record<string, unknown>;
                        return rest;
                    });
                out[k] = { total: arr.length, highlights };
            } else {
                out[k] = v;
            }
        }
        return out;
    });

    const compactStr = JSON.stringify(compacted, null, 2);
    // If still somehow over budget, hard-truncate with a note
    if (compactStr.length > budgetChars) {
        return compactStr.slice(0, budgetChars) + '\n… [truncated to fit context window]';
    }
    return compactStr;
}

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

export interface ChatResult {
    response: string;
    tokens: ChatTokenTotals;
}

export interface ClientHints {
    platform?: string;
    screenWidth?: number;
    screenHeight?: number;
}

export async function feralChatHeadless(
    userInput: string,
    onStatus?: (status: string) => void,
    onProcess?: (processJson: Record<string, unknown>) => void,
    onQuestion?: (question: string, options?: string[]) => Promise<string>,
    onChatId?: (chatId: string) => void,
    history?: ChatHistoryEntry[],
    platform?: BootstrapOptions['platform'],
    clientHints?: ClientHints,
): Promise<ChatResult> {
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

    try {
        const { result: response, tokens } = await runWithTokenTracker(() =>
            _feralChatHeadlessInner(userInput, status, onProcess, onQuestion, logger, chatId, history ?? [], platform, clientHints)
        );
        const totalCostUsd = tokens.calls.reduce((s, c) => s + c.costUsd, 0);
        await logger.log('summary', {
            inputTokens: tokens.inputTokens,
            outputTokens: tokens.outputTokens,
            totalTokens: tokens.totalTokens,
            estimatedCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
            calls: tokens.calls,
        });
        return { response, tokens };
    }
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
    clientHints?: ClientHints,
): Promise<string> {
    // ── Bootstrap Feral + load entity types + vault context ────────
    const inMemorySource = new InMemoryProcessSource();
    const [runtime, entityTypes, userName] = await Promise.all([
        bootstrapFeral({ processSources: [inMemorySource], platform }),
        loadEntityTypes().catch(() => []),
        getUserName().catch(() => 'friend'),
    ]);

    await logger.log('start', { chatId, userInput });

    const vaultContext = scrubSecrets(await getVaultContext().catch(() => '')) as string;

    const entityIndex = getEntityIndex();
    if (!entityIndex.isBuilt) await entityIndex.build();

    const [categorizeLlm, reasonLlm, chatLlm, reasonMapping] = await Promise.all([
        getModelForCapability('categorize'),
        getModelForCapability('reason'),
        getModelForCapability('chat'),
        getCapabilityModel('reason'),
    ]);
    const reasonModelName = reasonMapping?.model ?? 'gpt-4o';

    const moment = buildMomentContext();
    const globalsMap = momentToGlobals(moment, userName);
    void globalsMap; // used by removed context tree; kept for future use

    const relevance = await analyzeQueryRelevance(userInput, entityTypes, entityIndex);
    const historyBlock = formatHistoryBlock(history);
    const examplesStr = EXAMPLE_PROCESSES.map((ex, i) =>
        `Example ${i + 1}: ${ex.description}\n${JSON.stringify(ex.json, null, 2)}`
    ).join('\n\n');

    // ── PHASE 0: Process reuse check ─────────────────────────────────
    const allProcesses = runtime.processFactory.getAllProcesses()
        .filter(p => p.key !== 'chat.generated');

    if (allProcesses.length > 0) {
        status('Checking process library…');

        const processSummary = allProcesses
            .map(p => `- ${p.key}: ${p.description}`)
            .join('\n');

        const phase0Response = await categorizeLlm.chat(
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

        debug('chat', `Phase 0 response: ${phase0Response}`);

        try {
            const matchResult = parseJsonResponse(phase0Response) as {
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
                const finalResponse = await synthesizeResponse(
                    chatLlm, userInput, matchResult.reasoning,
                    [scrubbedResult], [], vaultContext, history, chatId, clientHints, reasonModelName,
                );
                await logger.log('response', { response: finalResponse });

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
            debug('chat', 'Phase 0 parse failed, falling through to custom pipeline');
        }
    }

    // ── PHASE 1: Intent classification ───────────────────────────────
    status('Understanding request…');
    const intent = await classifyIntent(
        categorizeLlm, userInput, history, entityTypes.map(et => et.name),
    );
    await logger.log('intent', {
        summary: intent.summary,
        actionType: intent.actionType,
        entityTypes: intent.entityTypes,
        timeframe: intent.timeframe,
        isSimple: intent.isSimple,
        confidence: intent.confidence,
    });

    // ── PHASE 2: Context manifest ────────────────────────────────────
    const manifest = buildContextManifest(entityIndex, entityTypes, moment, intent.entityTypes);
    await logger.log('context_manifest', {
        totalEntities: manifest.totalEntities,
        types: manifest.entityTypes.map(t => ({ type: t.type, count: t.count })),
    });

    // ── PHASE 3: Context selection loop ─────────────────────────────
    status('Gathering context…');
    const gathered = await runContextLoop(categorizeLlm, intent, manifest, entityIndex);
    await logger.log('context_fetch', {
        rounds: gathered.rounds,
        entityCount: gathered.nodes.length,
        summary: gathered.summary,
        fetchedTypes: [...new Set(gathered.nodes.map(n => n.type))],
    });

    debug('chat', `Context gathered: ${gathered.nodes.length} entities in ${gathered.rounds} round(s)`);

    // ── PHASE 4: Node selection ──────────────────────────────────────
    status('Selecting capabilities…');

    const intentRelevantTypes: RelevantType[] = intent.entityTypes.length > 0
        ? intent.entityTypes.map(t => ({ type: t, reason: 'mentioned' as const, matchCount: 0, matchSamples: [] }))
        : relevance.relevantTypes;

    const allNodes = runtime.catalog.getAllCatalogNodes();
    const filteredNodes = filterCatalogNodes(
        allNodes.filter(n => !n.key.startsWith('speak_')),
        intentRelevantTypes,
        entityTypes,
    );

    const nodesByGroup = new Map<string, typeof filteredNodes>();
    for (const n of filteredNodes) {
        const group = n.group;
        if (!nodesByGroup.has(group)) nodesByGroup.set(group, []);
        nodesByGroup.get(group)!.push(n);
    }
    const catalogSummary = Array.from(nodesByGroup.entries())
        .map(([group, nodes]) =>
            `[${group}]\n${nodes.map(n => `  ${n.key}: ${n.description || n.name}`).join('\n')}`)
        .join('\n');

    debug('chat', `Catalog: ${allNodes.length} total → ${filteredNodes.length} after intent filter`);

    const phase4Response = await categorizeLlm.chat(
        [{
            role: 'user' as const,
            content: `The user said: "${userInput}"
${historyBlock}
${serializeGatheredContext(gathered)}

Each entity type has create_*, list_*, find_*, update_*, delete_*, complete_*, set_{type}_{field} catalog nodes.
CRITICAL: Match entity types precisely — event≠task. Use create_event for appointments/meetings, create_task for todos.
For new content types (recipe, vehicle, etc.), select "create_content_type". Use "link_entities" to connect related entities.
For field values on creation, also select "set_context_value" to stage fields in context.

AVAILABLE CATALOG NODES:
${catalogSummary}

RULES:
- Always include "start" and "stop". Select only nodes needed for the request.
- Prefer entity nodes (create_*, complete_*, find_*) over llm_chat for data operations.
- For unknown content types, select "create_content_type". For multiple entities, select multiple create_* nodes.
- Proactively link related entities. Prefer action over questions — use sensible defaults.

Return a JSON object with this exact structure:
{
    "reasoning": "Why these nodes were selected",
    "nodes": ["start", "stop", "node_key_1", "node_key_2"]
}

Return ONLY the JSON object, no markdown fences.`,
        }],
        {
            systemPrompt: 'Select the minimal set of catalog nodes to fulfill the user\'s request. Always include "start" and "stop". Prefer entity actions over advice. Link related content proactively.',
            temperature: 0.3,
        },
    );

    debug('chat', `Phase 4 (node selection) response: ${phase4Response}`);

    let nodeSelection: { reasoning: string; nodes: string[] };
    try {
        nodeSelection = parseJsonResponse(phase4Response) as { reasoning: string; nodes: string[] };
    } catch (err) {
        debug('chat', `Phase 4 raw response: ${phase4Response}`);
        throw new Error(`Failed to parse node selection from LLM: ${err instanceof Error ? err.message : err}`);
    }

    await logger.log('node_selection', { reasoning: nodeSelection.reasoning, nodes: nodeSelection.nodes });

    if (!nodeSelection.nodes.includes('start')) nodeSelection.nodes.unshift('start');
    if (!nodeSelection.nodes.includes('stop')) nodeSelection.nodes.push('stop');

    const selectedNodes = nodeSelection.nodes
        .map(key => {
            try { return runtime.catalog.getCatalogNode(key); } catch { return null; }
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

    const nodeCodeDetails: string[] = [];
    for (const n of selectedNodes) {
        if (!n) continue;
        try {
            const nodeCode = runtime.nodeCodeFactory.getNodeCode(n.nodeCodeKey);
            const Ctor = nodeCode.constructor as { configDescriptions?: Array<{ key: string; name: string; description: string; type: string; default?: unknown; isOptional?: boolean; isSecret?: boolean }> };
            const Ctor2 = nodeCode.constructor as { resultDescriptions?: Array<{ status: string; description: string }> };
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
            // skip missing node codes
        }
    }

    // ── PHASES 5–7: Design → Execute → Check (loop) ──────────────────
    const MAX_ITERATIONS = 3;
    const allResults: Record<string, unknown>[] = [];
    const allReasonings: string[] = [];
    const allProcessKeys: string[] = [];
    let remainingWork = userInput;

    const gatheredContextStr = serializeGatheredContext(gathered);

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        // ── PHASE 5: Process design (reason model) ───────────────────
        status(`Designing process${iteration > 0 ? ` (step ${iteration + 1})` : ''}…`);

        const previousResultsStr = allResults.length > 0
            ? `\n\nRESULTS FROM PREVIOUS STEPS:\n${compactResultsForPrompt(allResults, reasonModelName)}`
            : '';

        const phase5Response = await reasonLlm.chat(
            [{
                role: 'user' as const,
                content: `Build a Feral process to handle: "${remainingWork}"
${historyBlock}${previousResultsStr}
${gatheredContextStr}

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

        debug('chat', `Phase 5 response (iteration ${iteration + 1}): ${phase5Response}`);

        let processDesign: { reasoning: string; process: Record<string, unknown> };
        try {
            processDesign = parseJsonResponse(phase5Response) as { reasoning: string; process: Record<string, unknown> };
        } catch (err) {
            debug('chat', `Phase 5 raw response: ${phase5Response}`);
            throw new Error(`Failed to parse process design from LLM: ${err instanceof Error ? err.message : err}`);
        }

        allReasonings.push(processDesign.reasoning);
        await logger.log('process_design', { iteration: iteration + 1, reasoning: processDesign.reasoning, process: processDesign.process });
        onProcess?.(processDesign.process);

        const processFingerprint = JSON.stringify(processDesign.process);
        if (allProcessKeys.includes(processFingerprint)) {
            debug('chat', `Duplicate process detected at iteration ${iteration + 1}, breaking loop`);
            break;
        }
        allProcessKeys.push(processFingerprint);

        // ── PHASE 6: Execute ─────────────────────────────────────────
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

        const iterationResult = Object.entries(contextResult)
            .filter(([k]) => k === '_error' || (!k.startsWith('_') && k !== 'user_input'))
            .reduce((acc, [k, v]) => {
                acc[k] = typeof v === 'string' && v.length > 2000 ? v.slice(0, 2000) + '…' : v;
                return acc;
            }, {} as Record<string, unknown>);

        allResults.push(scrubSecrets(iterationResult) as Record<string, unknown>);
        await logger.log('process_result', { iteration: iteration + 1, results: iterationResult });

        // ── PHASE 7: Completion check (categorize model) ─────────────
        if (iteration < MAX_ITERATIONS - 1) {
            status('Checking if task is complete…');

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

            debug('chat', `Phase 7 completion check (iteration ${iteration + 1}): ${completionResponse}`);

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

            remainingWork = completion.remaining || userInput;
            debug('chat', `More work needed: ${remainingWork}`);
        }
    }

    // ── PHASE 8: Synthesize response ─────────────────────────────────
    status('Composing response…');

    const nodesUsed = selectedNodes
        .filter(Boolean)
        .map(n => `- ${n!.key}: ${n!.description || n!.name}`);

    const finalResponse = await synthesizeResponse(
        chatLlm, userInput, allReasonings.join(' → ') || gathered.summary,
        allResults, nodesUsed, vaultContext, history, chatId, clientHints, reasonModelName,
    );
    await logger.log('response', { response: finalResponse });

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
    clientHints?: ClientHints,
    modelName = 'gpt-4o',
): Promise<string> {
    const clientHintBlock = clientHints?.platform === 'mobile'
        ? `CLIENT CONTEXT:
- Rendering on a mobile screen${clientHints.screenWidth ? ` (${clientHints.screenWidth}×${clientHints.screenHeight}px)` : ''}
- Prefer concise responses: short paragraphs, brief bullet lists; avoid wide tables or deeply nested structure
- Markdown renders correctly (bold, bullets, headers, code blocks are all fine)

`
        : '';

    const synthesisPrompt = `${clientHintBlock}The user said: "${userInput}"
${formatHistoryBlock(history)}
WHAT WAS DONE:
Reasoning: ${reasoning}

${results.length} process step(s) executed.

${nodesUsed.length > 0 ? `Nodes used:\n${nodesUsed.join('\n')}\n` : ''}Results:
${compactResultsForPrompt(results, modelName)}

${results.some(r => r._error) ? `Note: Some steps encountered errors.` : ''}

RESPONSE GUIDELINES:
- Summarise what was done concretely (created X, linked Y to Z, completed W)
- If entities were created or updated, name them so the user can find them
- If entities were linked, mention the relationship
- Keep it concise — a few sentences, not paragraphs
- If there were errors, acknowledge honestly and suggest alternatives
- If the results suggest follow-up actions, briefly mention them
${TOKEN_INSTRUCTIONS}
${UI_COMPONENT_INSTRUCTIONS}

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

    // Resolve datetime tokens ({{local_time:ISO}} etc.) to local-timezone strings
    responseText = resolveTokens(responseText);

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
