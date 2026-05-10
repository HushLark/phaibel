import type { LLMProvider } from '../llm/types.js';
import { parseJsonResponse } from '../utils/json-parser.js';
import { debug } from '../utils/debug.js';

export interface IntentResult {
    summary: string;
    actionType: 'query' | 'create' | 'update' | 'delete' | 'mixed';
    entityTypes: string[];
    timeframe: 'past' | 'present' | 'future' | 'range' | 'any';
    isSimple: boolean;
    confidence: number;
}

interface HistoryEntry {
    role: 'user' | 'assistant';
    content: string;
}

export async function classifyIntent(
    llm: LLMProvider,
    userInput: string,
    history: HistoryEntry[],
    availableEntityTypes: string[],
): Promise<IntentResult> {
    const recentHistory = history.slice(-4);
    const historyStr = recentHistory.length > 0
        ? '\nRecent conversation:\n' + recentHistory.map(h =>
            h.role === 'user' ? `User: ${h.content}` : `Assistant: ${h.content}`
        ).join('\n') + '\n'
        : '';

    const raw = await llm.chat(
        [{
            role: 'user' as const,
            content: `User said: "${userInput}"${historyStr}
Return JSON only:
{
  "summary": "one sentence describing what the user wants",
  "actionType": "query|create|update|delete|mixed",
  "entityTypes": ["task"],
  "timeframe": "past|present|future|range|any",
  "isSimple": true,
  "confidence": 0.9
}`,
        }],
        {
            systemPrompt: `You are an intent classifier for a personal assistant. Available entity types: ${availableEntityTypes.join(', ')}. Return JSON only.`,
            temperature: 0,
        },
    );

    try {
        const parsed = parseJsonResponse(raw) as unknown as IntentResult;
        debug('chat', `Intent: ${parsed.summary} (${parsed.actionType}, types=[${(parsed.entityTypes ?? []).join(',')}])`);
        return {
            summary: parsed.summary || userInput,
            actionType: parsed.actionType || 'mixed',
            entityTypes: Array.isArray(parsed.entityTypes) ? parsed.entityTypes : [],
            timeframe: parsed.timeframe || 'any',
            isSimple: Boolean(parsed.isSimple),
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
        };
    } catch {
        debug('chat', 'Intent parse failed, using fallback');
        return {
            summary: userInput,
            actionType: 'mixed',
            entityTypes: [],
            timeframe: 'any',
            isSimple: false,
            confidence: 0.5,
        };
    }
}
