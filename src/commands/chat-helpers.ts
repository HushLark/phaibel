// ─────────────────────────────────────────────────────────────────────────────
// Chat Pipeline Helpers — shared between chat.ts and pipeline NodeCodes
// ─────────────────────────────────────────────────────────────────────────────

import type { LLMProvider } from '../llm/types.js';
import { getModelForCapability, createSystemPrompt } from '../llm/router.js';
import { getContextWindowTokens } from '../config.js';
import { parseJsonResponse, extractResponseField } from '../utils/json-parser.js';
import { debug } from '../utils/debug.js';
import { appendJudgement } from '../utils/chat-logger.js';
import { resolveTokens, TOKEN_INSTRUCTIONS } from '../utils/token-resolver.js';
import { UI_COMPONENT_INSTRUCTIONS } from '../utils/ui-components.js';
import { generateNodeId, ensureEntityDir, writeEntity, nodeFilename, listEntities } from '../entities/entity.js';
import { getEntityType } from '../entities/entity-type-config.js';
import type { ProcessSource } from '../feral/process/process-factory.js';
import type { Process } from '../feral/process/process.js';

// ─────────────────────────────────────────────────────────────────────────────
// SHARED TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatHistoryEntry {
    role: 'user' | 'assistant';
    content: string;
}

export interface ClientHints {
    platform?: string;
    screenWidth?: number;
    screenHeight?: number;
    creditsRemaining?: number;
    creditsLimit?: number;
    sessionResetAt?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY PROCESS SOURCE (used by chat pipeline to register generated procs)
// ─────────────────────────────────────────────────────────────────────────────

export class InMemoryProcessSource implements ProcessSource {
    private processes: Process[] = [];

    add(process: Process): void {
        this.processes.push(process);
    }

    getProcesses(): Process[] {
        return this.processes;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXAMPLE PROCESSES (reference for LLM process generation prompts)
// ─────────────────────────────────────────────────────────────────────────────

export const EXAMPLE_PROCESSES = [
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
                { key: 'create_entity', catalog_node_key: 'create_entity', configuration: { entity_type: 'recipe', entity_title: 'Chocolate Chip Cookies', entity_body: 'Ingredients: flour, butter, sugar, eggs, chocolate chips.\nBake at 375F for 10 min.' }, edges: { ok: 'done', already_exists: 'done', error: 'done' } },
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
        description: 'Migrate existing entities to a new content type',
        json: {
            schema_version: 1,
            key: 'type.migrate',
            description: 'Create a soccer_game content type and convert existing soccer events to it',
            context: {},
            nodes: [
                { key: 'start', catalog_node_key: 'start', configuration: {}, edges: { ok: 'create_type' } },
                { key: 'create_type', catalog_node_key: 'create_content_type', configuration: { type_name: 'soccer_game', description: 'A soccer game with date, venue, opponent, and score' }, edges: { ok: 'list_old', already_exists: 'list_old', error: 'done' } },
                { key: 'list_old', catalog_node_key: 'search_events', configuration: { query: 'soccer game', context_path: 'events_to_migrate' }, edges: { ok: 'iter', error: 'done' } },
                { key: 'iter', catalog_node_key: 'array_iterator', configuration: { source_context_path: 'events_to_migrate', item_context_path: '_item', spread_fields: true }, edges: { ok: 'create_new', done: 'done' } },
                { key: 'create_new', catalog_node_key: 'create_entity', configuration: { entity_type: 'soccer_game', entity_title_context_key: 'title', entity_body_context_key: 'body' }, edges: { ok: 'delete_old', already_exists: 'delete_old', error: 'iter' } },
                { key: 'delete_old', catalog_node_key: 'delete_event', configuration: { title_context_key: 'title' }, edges: { ok: 'iter', not_found: 'iter', error: 'iter' } },
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

export const MAX_HISTORY_PAIRS = 3;

export function formatHistoryBlock(history: ChatHistoryEntry[]): string {
    if (history.length === 0) return '';
    const lines = history.map(h =>
        h.role === 'user' ? `User: ${h.content}` : `Assistant: ${h.content}`,
    );
    return `\nRECENT CONVERSATION (last ${Math.ceil(history.length / 2)} exchange(s) — use this for context when the user refers to previous requests):\n${lines.join('\n')}\n`;
}

// ─────────────────────────────────────────────────────────────────────────────
// RESULTS COMPACTION
// ─────────────────────────────────────────────────────────────────────────────

const TODAY_MS = () => Date.now();

export function compactResultsForPrompt(results: Record<string, unknown>[], modelName: string): string {
    const windowTokens = getContextWindowTokens(modelName);
    const budgetChars = windowTokens * 4 * 0.40;

    const full = JSON.stringify(results, null, 2);
    if (full.length <= budgetChars) return full;

    const now = TODAY_MS();
    const compacted = results.map(r => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) {
            if (Array.isArray(v) && v.length > 0 && v[0] !== null && typeof v[0] === 'object') {
                const arr = v as Record<string, unknown>[];
                const withDate = arr.map(item => {
                    const dateStr = Object.values(item).find(
                        x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x as string)
                    ) as string | undefined;
                    return { item, ts: dateStr ? new Date(dateStr).getTime() : Infinity };
                });
                withDate.sort((a, b) => a.ts - b.ts);
                const highlights = withDate
                    .filter(x => x.ts === Infinity || x.ts >= now - 86_400_000)
                    .slice(0, 20)
                    .map(x => {
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
    if (compactStr.length > budgetChars) {
        return compactStr.slice(0, budgetChars) + '\n… [truncated to fit context window]';
    }
    return compactStr;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECRET SCRUBBER
// ─────────────────────────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
    /sk-[a-zA-Z0-9_-]{20,}/g,
    /sk-ant-[a-zA-Z0-9_-]{20,}/g,
    /ghp_[a-zA-Z0-9]{36,}/g,
    /ghu_[a-zA-Z0-9]{36,}/g,
    /xox[bsarp]-[a-zA-Z0-9\-]{10,}/g,
];

const SECRET_KEYS = new Set([
    'apiKey', 'api_key', 'apikey',
    'secret', 'token', 'password',
    'authorization', 'credential',
]);

export function scrubSecrets(obj: unknown): unknown {
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

// ─────────────────────────────────────────────────────────────────────────────
// SYNTHESIS
// ─────────────────────────────────────────────────────────────────────────────

export async function synthesizeResponse(
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
    sourceScopeName?: string,
    federatedContext?: string,
    allowAssumedNodes = true,
): Promise<string> {
    const sessionLine = (() => {
        if (!clientHints?.creditsLimit) return '';
        const used = (clientHints.creditsLimit) - (clientHints.creditsRemaining ?? 0);
        const resets = clientHints.sessionResetAt
            ? new Date(clientHints.sessionResetAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : null;
        const hoursLeft = clientHints.sessionResetAt
            ? Math.max(0, Math.round((new Date(clientHints.sessionResetAt).getTime() - Date.now()) / 3_600_000))
            : null;
        return `- Session credits: ${used} used of ${clientHints.creditsLimit} (${clientHints.creditsRemaining ?? 0} remaining)${resets ? `; resets ${resets}${hoursLeft !== null ? ` (${hoursLeft}h from now)` : ''}` : ''}`;
    })();

    const clientHintBlock = clientHints?.platform === 'mobile'
        ? `CLIENT CONTEXT:
- Rendering on a mobile screen${clientHints.screenWidth ? ` (${clientHints.screenWidth}×${clientHints.screenHeight}px)` : ''}
- Prefer concise responses: short paragraphs, brief bullet lists; avoid wide tables or deeply nested structure
- Markdown renders correctly (bold, bullets, headers are all fine)
- Do NOT use fenced code blocks (\`\`\`) — they display as gray boxes and should be avoided entirely
${sessionLine ? sessionLine + '\n' : ''}
`
        : '';

    const scopeBlock = sourceScopeName
        ? `CONNECTION SCOPE:
This question is scoped to the connected source "${sourceScopeName}". The context below was pulled from it. Attribute facts to it by name — e.g. "In ${sourceScopeName}, …" or "${sourceScopeName} has …" — and do not imply the information is from elsewhere.

`
        : '';

    const federatedBlock = federatedContext
        ? `FEDERATED CONTEXT (mirrored from connected sources — cite the source by name):
${federatedContext}

`
        : '';

    const synthesisPrompt = `${clientHintBlock}${scopeBlock}${federatedBlock}The user said: "${userInput}"
${formatHistoryBlock(history)}
WHAT WAS DONE:
Reasoning: ${reasoning}

${results.length} process step(s) executed.

${nodesUsed.length > 0 ? `Nodes used:\n${nodesUsed.join('\n')}\n` : ''}Results:
${compactResultsForPrompt(results, modelName)}

${results.some(r => r._error) ? `Note: Some steps encountered errors.` : ''}

RESPONSE GUIDELINES:
- When a fact comes from a connected source (see FEDERATED/CONNECTION context), attribute it by name, e.g. "${sourceScopeName || 'Acme'} has …" or "In ${sourceScopeName || 'Acme'}, …". Don't present federated facts as if they originated locally.
- Answer ONLY what was asked. Retrieved context often contains items that are merely keyword-similar to the question — do NOT mention them, do NOT append "you also have…" asides about unrelated notes/tasks. Volunteering unrelated items reads as a retrieval mistake.
- Summarise what was done concretely (created X, linked Y to Z, completed W)
- If entities were created or updated, name them so the user can find them
- If entities were linked, mention the relationship
- Keep it concise — a few sentences, not paragraphs
- If there were errors, acknowledge honestly and suggest alternatives
- If the results suggest follow-up actions, briefly mention them
${TOKEN_INSTRUCTIONS}
${UI_COMPONENT_INSTRUCTIONS}

${allowAssumedNodes ? `ASSUMED CONTEXT NODES:
If the user casually mentions people, places, projects, or other notable entities that don't already exist in context, include them in "assumed_nodes" so they can be saved automatically. Only include entities that are clearly worth remembering — not throwaway mentions. Do NOT re-add an entity already created or present in this turn's context. Each assumed node needs: contextType (must match an available type like "person", "note", etc.), title, and any fields you can infer.
For a "person", always infer a relationship "type" field from how they're described, using one of: family (spouse, child, parent, sibling, relative), friend, colleague (coworker, manager, direct report, teammate), professional (vendor, client, contact at another company), acquaintance. E.g. "my manager Sam" → {"contextType":"person","title":"Sam","type":"colleague"}; "my daughter Emma" → {"contextType":"person","title":"Emma","type":"family"}.` : `ASSUMED CONTEXT NODES:
This is a read-only question — do NOT save anything. Return an empty "assumed_nodes" array.`}

Do NOT include fenced code blocks (\`\`\`) anywhere in the "response" value.

You MUST return valid JSON with this structure:
{
    "response": "Your natural response to the user (markdown ok)",
    "assumed_nodes": []
}`;

    const rawResponse = await llm.chat(
        [{ role: 'user' as const, content: synthesisPrompt }],
        {
            systemPrompt: createSystemPrompt(vaultContext || ''),
            temperature: 0.7,
        },
    );

    let responseText: string;
    try {
        const parsed = parseJsonResponse(rawResponse);
        responseText = (parsed.response as string) || rawResponse.trim();

        try {
            const assumedNodes = parsed.assumed_nodes as Array<{ contextType: string; title: string; [key: string]: unknown }> | undefined;
            if (allowAssumedNodes && assumedNodes && assumedNodes.length > 0) {
                createAssumedNodes(assumedNodes).catch(err => debug('chat', `Assumed node creation failed: ${err}`));
            }
        } catch (e) {
            debug('chat', `Node extraction failed: ${e}`);
        }
    } catch {
        const extracted = extractResponseField(rawResponse);
        if (extracted) {
            responseText = extracted;
            debug('chat', 'Synthesis JSON malformed — extracted response field by boundary search');
        } else {
            responseText = rawResponse.trim();
            debug('chat', 'Synthesis returned plain text');
        }
    }

    responseText = resolveTokens(responseText);

    if (chatId) {
        judgeResponse(userInput, responseText, chatId).catch(() => {});
    }

    return responseText;
}

// ─────────────────────────────────────────────────────────────────────────────
// ASSUMED NODE CREATION
// ─────────────────────────────────────────────────────────────────────────────

export async function createAssumedNodes(
    nodes: Array<{ contextType: string; title: string; [key: string]: unknown }>,
): Promise<void> {
    for (const node of nodes) {
        if (!node.contextType || !node.title) continue;

        const typeConfig = await getEntityType(node.contextType);
        if (!typeConfig) {
            debug('chat', `Assumed node skipped — unknown type: ${node.contextType}`);
            continue;
        }

        try {
            const titleLc = node.title.trim().toLowerCase();
            const existing = await listEntities(node.contextType, { metaOnly: true });
            if (existing.some(e => String(e.meta.title ?? e.meta.name ?? '').trim().toLowerCase() === titleLc)) {
                debug('chat', `Assumed node skipped — already exists: ${node.contextType}/${node.title}`);
                continue;
            }
        } catch { /* best-effort dedup */ }

        const id = generateNodeId();
        const now = new Date().toISOString();
        const meta: Record<string, unknown> = {
            id,
            title: node.title,
            contextType: node.contextType,
            created: now,
            source: 'assumed',
        };

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
// POST-MESSAGE JUDGE
// ─────────────────────────────────────────────────────────────────────────────

export async function judgeResponse(
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
