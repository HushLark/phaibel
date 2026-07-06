// ─────────────────────────────────────────────────────────────────────────────
// REQUEST CLASSIFIER
// First step in the agent flow: safety guardrails + intent categorization.
//
// A single fast LLM call that does two things at once:
//   1. Guardrail check — stop immediately on illegal / self-harm / harm-to-others
//   2. Intent categorization into one of 7 named categories
//   3. Extraction of timeframes, subjects, and attributes for the planner step
//
// Callers: if result.blocked === true, return BLOCKED_RESPONSE immediately.
// Do NOT log, explain, or engage further on a blocked request.
// ─────────────────────────────────────────────────────────────────────────────

import type { LLMProvider } from '../llm/types.js';
import { parseJsonResponse } from '../utils/json-parser.js';
import { debug } from '../utils/debug.js';
import { todayStr } from '../entities/temporal-filter.js';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The 7 request categories Phaibel can handle, plus 'none' for unclassifiable.
 *
 * chat          — Small talk, greetings, phatic exchanges ("hey!", "thanks", "lol")
 * query         — Asking for information from memory ("what tasks do I have today?")
 * factual       — Current real-world data needing live lookup ("weather in Tokyo", "USD/EUR rate", "AAPL price", "flight UA123 status")
 * task          — Imperative actions ("add a reminder", "schedule a meeting", "mark done")
 * remember      — Persisting facts about the user's world ("I'm allergic to X", "my boss is Y")
 * create        — Generating new content ("write a note", "draft a plan", "compose an email")
 * analytical    — Analysis, trends, insights ("am I making progress?", "what should I focus on?")
 * introspection — Questions about the agent or its stored knowledge ("what do you know about me?")
 * none          — Doesn't clearly fit any of the above
 */
export type RequestCategory =
    | 'chat'
    | 'query'
    | 'factual'
    | 'task'
    | 'remember'
    | 'create'
    | 'analytical'
    | 'introspection'
    | 'none';

/**
 * A temporal reference extracted from the request text.
 */
export interface TimeframeRef {
    /** Raw text from the request, e.g. "tomorrow", "next week", "by Friday" */
    label: string;
    /** relative = "tomorrow/next week", absolute = "June 3rd/2026-05-30", recurring = "every Monday" */
    type: 'relative' | 'absolute' | 'recurring';
    /** Temporal direction relative to the current moment */
    direction: 'past' | 'present' | 'future';
    /** YYYY-MM-DD if the reference can be resolved to a specific date */
    isoDate?: string;
}

/**
 * A subject (entity, person, or concept) mentioned in the request.
 */
export interface SubjectRef {
    /** Raw text, e.g. "dentist appointment", "tasks", "my sister" */
    text: string;
    /** Mapped context-type name if recognizable: task, event, note, goal, person, research */
    entityType?: string;
}

/**
 * A filter or modifier applied to a subject.
 */
export interface AttributeRef {
    /** Raw attribute text, e.g. "overdue", "urgent", "high priority" */
    text: string;
    /** filter: narrows retrieval scope; modifier: changes how to act; qualifier: adds context */
    type: 'filter' | 'modifier' | 'qualifier';
}

/**
 * Successful classification — request is safe and fully categorized.
 */
export interface ClassificationResult {
    blocked: false;
    /** Primary intent category */
    category: RequestCategory;
    /** Confidence in the category [0, 1] */
    confidence: number;
    /** One-sentence description of what the user wants */
    summary: string;
    timeframes: TimeframeRef[];
    subjects: SubjectRef[];
    attributes: AttributeRef[];
    /** Alternate retrieval terms (synonyms/related words) for vocabulary-mismatch recall. */
    expansion?: string[];
}

/**
 * Guardrail hit — request involves illegal activity, self-harm, or harm to others.
 * The caller MUST stop all processing and return BLOCKED_RESPONSE to the user.
 */
export interface GuardrailResult {
    blocked: true;
}

export type ClassifyResult = ClassificationResult | GuardrailResult;

/**
 * The user-facing response when a guardrail is triggered.
 * Intentionally terse — no explanation, no reason, no advice.
 */
export const BLOCKED_RESPONSE = "I'm not able to help with that.";

// ─────────────────────────────────────────────────────────────────────────────
// PROMPTS
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the request classifier for a personal AI assistant. Your job:
1. Safety check — block if needed
2. Classify the intent into exactly one category
3. Extract timeframes, subjects, and attributes

SAFETY GUARDRAILS — return {"blocked":true} and nothing else if the request involves:
- Illegal activities (hacking, fraud, weapons, drug synthesis, identity theft, etc.)
- Self-harm, suicide, or eating disorder facilitation
- Harming, threatening, or stalking another person

CATEGORIES (pick exactly one):
chat          — Small talk, greetings, phatic exchanges ("hey", "thanks", "how are you?", "lol")
query         — Asking for information from stored memory ("what tasks do I have?", "when is my dentist?")
factual       — Current real-world data requiring live lookup: weather, exchange rates, stock prices, news headlines, flight status, sports scores, interest rates ("what's the weather in NYC?", "USD to EUR today", "is my flight on time?", "current federal funds rate")
task          — Imperative actions to perform ("add a task", "schedule meeting", "remind me", "mark done", "delete")
remember      — Persisting a fact, preference, or relationship ("I'm allergic to X", "my sister's birthday is June 3")
create        — Generating or composing new content ("write a note", "draft an email", "create a plan")
analytical    — Analysis, patterns, insights, recommendations ("how productive am I?", "what should I focus on?")
introspection — Questions about the assistant or its stored knowledge ("what do you know about me?", "what can you do?")
none          — Doesn't fit any of the above

TIMEFRAMES — extract all temporal references. Resolve relative dates using today (provided below).
  type: relative ("tomorrow", "next week"), absolute ("June 3rd"), recurring ("every Monday")
  direction: past ("yesterday"), present ("today", "now"), future ("tomorrow", "next month")

SUBJECTS — things being referenced. Map to entity type if obvious: task, event, note, goal, person, research.

ATTRIBUTES — filters/modifiers: "overdue" → filter, "urgent" → modifier, "completed" → filter.

EXPANSION — for query/analytical/introspection requests, list 4-6 single words a stored note answering this request would likely CONTAIN, prioritising words the user did NOT say. Use CONCRETE nouns naming things, places, people, months — the vocabulary of the ANSWER, not of the question. Avoid abstract planning words (itinerary, details, information, dates, budget). Examples: "what was that noise in the car?" → ["mechanic","garage","brake","engine","repair"]; "plans for our summer getaway?" → ["vacation","cottage","cabin","beach","lake","flight","July"]. For other categories return [].

Return JSON only. No markdown fences.`;

function buildUserMessage(
    input: string,
    today: string,
    history: Array<{ role: string; content: string }>,
): string {
    const historyBlock = history.length > 0
        ? '\nRecent conversation:\n' + history.slice(-3).map(h =>
            h.role === 'user' ? `User: ${h.content}` : `Assistant: ${h.content}`
        ).join('\n') + '\n'
        : '';

    return `Today: ${today}

Request: "${input}"${historyBlock}

Return JSON:
{
  "blocked": false,
  "category": "query",
  "confidence": 0.92,
  "summary": "user wants to see overdue tasks",
  "timeframes": [{"label": "today", "type": "relative", "direction": "present", "isoDate": "${today}"}],
  "subjects": [{"text": "tasks", "entityType": "task"}],
  "attributes": [{"text": "overdue", "type": "filter"}],
  "expansion": ["deadline", "due", "pending"]
}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSING HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const VALID_CATEGORIES = new Set<RequestCategory>([
    'chat', 'query', 'factual', 'task', 'remember', 'create', 'analytical', 'introspection', 'none',
]);

function parseTimeframes(raw: unknown): TimeframeRef[] {
    if (!Array.isArray(raw)) return [];
    const results: TimeframeRef[] = [];
    for (const t of raw as unknown[]) {
        const tf = t as Record<string, unknown>;
        const label = String(tf.label ?? '').trim();
        if (!label) continue;
        const rawType = String(tf.type ?? '');
        const rawDir  = String(tf.direction ?? '');
        const result: TimeframeRef = {
            label,
            type: (['relative', 'absolute', 'recurring'].includes(rawType)
                ? rawType : 'relative') as TimeframeRef['type'],
            direction: (['past', 'present', 'future'].includes(rawDir)
                ? rawDir : 'future') as TimeframeRef['direction'],
        };
        if (typeof tf.isoDate === 'string' && tf.isoDate.length === 10) {
            result.isoDate = tf.isoDate;
        }
        results.push(result);
    }
    return results;
}

function parseSubjects(raw: unknown): SubjectRef[] {
    if (!Array.isArray(raw)) return [];
    const results: SubjectRef[] = [];
    for (const s of raw as unknown[]) {
        const sub  = s as Record<string, unknown>;
        const text = String(sub.text ?? '').trim();
        if (!text) continue;
        const result: SubjectRef = { text };
        if (typeof sub.entityType === 'string' && sub.entityType.length > 0) {
            result.entityType = sub.entityType;
        }
        results.push(result);
    }
    return results;
}

function parseAttributes(raw: unknown): AttributeRef[] {
    if (!Array.isArray(raw)) return [];
    const results: AttributeRef[] = [];
    for (const a of raw as unknown[]) {
        const attr = a as Record<string, unknown>;
        const text = String(attr.text ?? '').trim();
        if (!text) continue;
        const rawType = String(attr.type ?? '');
        results.push({
            text,
            type: (['filter', 'modifier', 'qualifier'].includes(rawType)
                ? rawType : 'filter') as AttributeRef['type'],
        });
    }
    return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// FALLBACK
// ─────────────────────────────────────────────────────────────────────────────

function fallbackResult(input: string): ClassificationResult {
    return {
        blocked: false,
        category: 'none',
        confidence: 0.3,
        summary: input,
        timeframes: [],
        subjects: [],
        attributes: [],
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// BACKWARD COMPAT BRIDGE
// ─────────────────────────────────────────────────────────────────────────────

import type { IntentResult } from './intent-classifier.js';

const CATEGORY_ACTION_MAP: Record<RequestCategory, IntentResult['actionType']> = {
    chat:          'query',
    query:         'query',
    factual:       'query',
    task:          'mixed',
    remember:      'create',
    create:        'create',
    analytical:    'query',
    introspection: 'query',
    none:          'mixed',
};

/**
 * Convert a ClassificationResult to the legacy IntentResult shape used by
 * context-loop.ts and other downstream consumers.
 */
export function toIntentResult(result: ClassificationResult): IntentResult {
    const directions = result.timeframes.map(t => t.direction);
    const timeframe: IntentResult['timeframe'] =
        directions.includes('past')    ? 'past'    :
        directions.includes('future')  ? 'future'  :
        directions.includes('present') ? 'present' : 'any';

    return {
        summary: result.summary,
        actionType: CATEGORY_ACTION_MAP[result.category],
        entityTypes: result.subjects
            .filter(s => s.entityType !== undefined)
            .map(s => s.entityType!),
        timeframe,
        isSimple: result.category === 'chat' || result.confidence >= 0.85,
        confidence: result.confidence,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify a user request. Call this as the very first step in the agent flow.
 *
 * If result.blocked === true:
 *   - Return BLOCKED_RESPONSE to the user
 *   - Stop all further processing
 *   - Do not log or surface details about why it was blocked
 *
 * If result.blocked === false:
 *   - Use result.category to route the request
 *   - Use toIntentResult(result) for backward-compat with context-loop
 */
export async function classifyRequest(
    llm: LLMProvider,
    input: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
    today = todayStr(),
): Promise<ClassifyResult> {
    let raw: string;
    try {
        raw = await llm.chat(
            [{ role: 'user', content: buildUserMessage(input, today, history) }],
            { systemPrompt: SYSTEM_PROMPT, temperature: 0 },
        );
    } catch (err) {
        debug('classify', `LLM call failed: ${err}`);
        return fallbackResult(input);
    }

    let parsed: Record<string, unknown>;
    try {
        parsed = parseJsonResponse(raw) as Record<string, unknown>;
    } catch {
        debug('classify', 'JSON parse failed, using fallback');
        return fallbackResult(input);
    }

    if (parsed.blocked === true) {
        debug('classify', 'Request blocked by guardrail');
        return { blocked: true };
    }

    const rawCategory = String(parsed.category ?? '');
    const category: RequestCategory = VALID_CATEGORIES.has(rawCategory as RequestCategory)
        ? rawCategory as RequestCategory
        : 'none';

    const result: ClassificationResult = {
        blocked: false,
        category,
        confidence: typeof parsed.confidence === 'number'
            ? Math.max(0, Math.min(1, parsed.confidence)) : 0.7,
        summary: typeof parsed.summary === 'string' && parsed.summary.length > 0
            ? parsed.summary : input,
        timeframes: parseTimeframes(parsed.timeframes),
        subjects:   parseSubjects(parsed.subjects),
        expansion:  Array.isArray(parsed.expansion)
            ? (parsed.expansion as unknown[]).filter((t): t is string => typeof t === 'string' && t.trim().length > 0).slice(0, 6)
            : [],
        attributes: parseAttributes(parsed.attributes),
    };

    debug('classify', `${result.category} (${(result.confidence * 100).toFixed(0)}%) — ${result.summary}`);
    return result;
}
