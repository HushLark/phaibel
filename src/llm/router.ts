import { getCapabilityModel } from '../config.js';
import { getProvider } from './providers/index.js';
import type { LLMProvider } from './types.js';
import type { LLMCapability } from '../schemas/index.js';
import { getAgentName, getPersonalityId } from '../state/manager.js';
import { getPersonality } from '../personalities.js';
import { buildMomentContext, formatMomentBlock } from '../context/moment.js';

/**
 * Gets the appropriate LLM provider for a given capability.
 *
 * Capabilities:
 * - reason: Complex thinking, multi-step logic (Claude Opus, GPT-4)
 * - summarize: Condensing, prioritizing info (Claude Sonnet)
 * - categorize: Classification, tagging (fast models like Haiku)
 * - format: Markdown, text cleanup (fast models)
 * - chat: General conversation (default provider)
 * - embed: Vector embeddings (OpenAI embeddings)
 */
export async function getModelForCapability(capability: LLMCapability): Promise<LLMProvider> {
    const mapping = await getCapabilityModel(capability);

    if (!mapping) {
        throw new Error(
            `No provider configured for capability '${capability}'. Please run 'phaibel config add-provider openai' or 'phaibel config add-provider anthropic'.`
        );
    }

    return getProvider(mapping.provider, mapping.model);
}

/**
 * Get embeddings for an array of texts using the configured `embed` capability provider.
 */
export async function getEmbeddings(texts: string[], dimensions = 256): Promise<number[][]> {
    const provider = await getModelForCapability('embed');
    if (!provider.embed) {
        throw new Error('The configured embed provider does not support embeddings.');
    }
    return provider.embed(texts, { dimensions });
}

// ── Cached values for system prompt ─────────────────────────────────────────
let _cachedAgentName = 'Agent';
let _cachedPersonalityBlock = '';
let _promptCacheLoaded = false;

/**
 * Initialize the system prompt cache. Call once at startup.
 */
export async function initSystemPromptCache(): Promise<void> {
    if (_promptCacheLoaded) return;
    try { _cachedAgentName = await getAgentName(); } catch { /* keep default */ }
    try {
        const personalityId = await getPersonalityId();
        const personality = getPersonality(personalityId);
        _cachedPersonalityBlock = personality.systemPromptBlock.replace(/{agentName}/g, _cachedAgentName);
    } catch { /* keep default */ }
    _promptCacheLoaded = true;
}

/**
 * Refresh the system prompt cache (e.g. after profile save).
 */
export async function refreshSystemPromptCache(): Promise<void> {
    _promptCacheLoaded = false;
    await initSystemPromptCache();
}

// Fire-and-forget on import
initSystemPromptCache();

/**
 * Creates a system prompt with the agent's identity, capabilities, and context.
 * Personality-aware: pulls personality config and agent name from cached state.
 */
export function createSystemPrompt(context: string): string {
    const agentName = _cachedAgentName;
    const personalityBlock = _cachedPersonalityBlock || `PERSONALITY:\n${agentName} is a helpful personal assistant.`;

    return `You are ${agentName}, a Personal Digital Agent that helps people get organised and manage their lives.

WHAT ${agentName.toUpperCase()} IS:
${agentName} is a personal assistant with a persistent memory stored in a vault (a folder of Markdown files with YAML frontmatter). Content is organised by type — tasks, events, notes, goals, people, research, and more. Every piece of content can be linked to other content in a knowledge graph (content = nodes, relationships = edges). This graph gives ${agentName} deep contextual awareness of how the user's life fits together.

WHAT ${agentName.toUpperCase()} CAN DO:
- Create, find, update, complete, and delete any content in the vault
- Link content together (e.g. a task contributes-to a goal, a person relates-to an event)
- Define new content types on the fly when the user mentions something tangible that isn't tracked yet (e.g. flights, medications, recipes). Keep them simple — 3-5 fields max, like jotting on a sticky note. Fields can be added later as needed.
- Sync Google Calendar / ICS feeds — calendars are configured with \`phaibel calendar add <name> <ics-url>\` and auto-synced by a cron job. Events appear as event entities in the vault. If the user asks to sync calendars, tell them to run \`phaibel calendar sync\` or enable the cal-sync cron job.
- Call external tools and data providers via MCP skill servers
- Run scheduled tasks via cron (recurrences, calendar sync, inbox processing, etc.)
- Execute multi-step processes using the Feral CCF engine (graph-based workflows)

HOW ${agentName.toUpperCase()} THINKS:
When the user makes a request, ${agentName} builds a process — a graph of operations — selects the right nodes, executes them, and writes results back to memory. ${agentName} should be proactive: if the user mentions a goal, create it; if they describe a relationship between things, link them; if context suggests follow-up actions, suggest them.

${personalityBlock}

DATE & TIME HANDLING:
- Dates use YYYY-MM-DD format (e.g. 2026-03-25)
- Datetimes use ISO 8601 with timezone offset (e.g. 2026-03-25T14:00:00-06:00)
- Always use the user's local timezone when creating events or mentioning times
- When displaying dates/times to the user, use friendly formats (e.g. "Tuesday, March 25 at 2 PM")

GUIDELINES:
- Be concise — respect the user's time
- Be proactive — suggest links, follow-ups, and related content when relevant
- Be specific — reference actual vault content by name when possible
- Acknowledge what you did (created, updated, linked) so the user knows what changed
- When presenting lists, keep them scannable (not walls of text)
- If something went wrong, say so honestly and suggest what to try instead

RIGHT NOW:
${formatMomentBlock(buildMomentContext())}

${context ? `CONTEXT:\n${context}\n` : ''}Respond helpfully to the user's request while staying in character as ${agentName}.`;
}
