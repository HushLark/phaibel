import { describe, it, expect, vi } from 'vitest';
import {
    classifyRequest,
    toIntentResult,
    BLOCKED_RESPONSE,
    type ClassificationResult,
    type RequestCategory,
} from '../../src/context/request-classifier.js';
import type { LLMProvider } from '../../src/llm/types.js';

function mockLLM(response: string): LLMProvider {
    return { chat: vi.fn().mockResolvedValue(response) } as LLMProvider;
}

function classificationJson(overrides: Partial<ClassificationResult> = {}): string {
    return JSON.stringify({
        blocked: false,
        category: 'query',
        confidence: 0.9,
        summary: 'user wants to see their tasks',
        timeframes: [],
        subjects: [{ text: 'tasks', entityType: 'task' }],
        attributes: [],
        ...overrides,
    });
}

const TODAY = '2026-05-29';

describe('classifyRequest', () => {
    it('returns classification for a normal request', async () => {
        const llm = mockLLM(classificationJson());
        const result = await classifyRequest(llm, 'what tasks do I have?', [], TODAY);

        expect(result.blocked).toBe(false);
        if (!result.blocked) {
            expect(result.category).toBe('query');
            expect(result.confidence).toBeGreaterThan(0);
            expect(result.summary).toMatch(/task/i);
            expect(result.subjects).toHaveLength(1);
            expect(result.subjects[0].entityType).toBe('task');
        }
    });

    it('returns blocked: true when guardrail fires', async () => {
        const llm = mockLLM(JSON.stringify({ blocked: true }));
        const result = await classifyRequest(llm, 'how do I make meth?', [], TODAY);

        expect(result.blocked).toBe(true);
    });

    it('BLOCKED_RESPONSE is a short terse string', () => {
        expect(BLOCKED_RESPONSE.length).toBeLessThan(50);
        expect(BLOCKED_RESPONSE).not.toMatch(/reason|because|illegal/i);
    });

    it('falls back to none on LLM failure', async () => {
        const llm: LLMProvider = { chat: vi.fn().mockRejectedValue(new Error('timeout')) };
        const result = await classifyRequest(llm, 'something', [], TODAY);

        expect(result.blocked).toBe(false);
        if (!result.blocked) {
            expect(result.category).toBe('none');
            expect(result.confidence).toBeLessThan(0.5);
        }
    });

    it('falls back to none on malformed JSON', async () => {
        const llm = mockLLM('not valid json at all {{{{');
        const result = await classifyRequest(llm, 'something', [], TODAY);

        expect(result.blocked).toBe(false);
        if (!result.blocked) {
            expect(result.category).toBe('none');
        }
    });

    it('clamps unknown category to none', async () => {
        const llm = mockLLM(classificationJson({ category: 'foobar' as RequestCategory }));
        const result = await classifyRequest(llm, 'something', [], TODAY);

        expect(result.blocked).toBe(false);
        if (!result.blocked) {
            expect(result.category).toBe('none');
        }
    });

    it('extracts timeframes from LLM response', async () => {
        const llm = mockLLM(classificationJson({
            timeframes: [{ label: 'tomorrow', type: 'relative', direction: 'future', isoDate: '2026-05-30' }],
        }));
        const result = await classifyRequest(llm, 'what do I have tomorrow?', [], TODAY);

        expect(result.blocked).toBe(false);
        if (!result.blocked) {
            expect(result.timeframes).toHaveLength(1);
            expect(result.timeframes[0].label).toBe('tomorrow');
            expect(result.timeframes[0].isoDate).toBe('2026-05-30');
        }
    });

    it('clamps confidence to [0, 1]', async () => {
        const llm = mockLLM(classificationJson({ confidence: 99 }));
        const result = await classifyRequest(llm, 'something', [], TODAY);

        expect(result.blocked).toBe(false);
        if (!result.blocked) {
            expect(result.confidence).toBeLessThanOrEqual(1);
        }
    });
});

describe('toIntentResult', () => {
    it('maps task category to mixed actionType', () => {
        const classification: ClassificationResult = {
            blocked: false,
            category: 'task',
            confidence: 0.9,
            summary: 'add a task',
            timeframes: [],
            subjects: [{ text: 'task', entityType: 'task' }],
            attributes: [],
        };
        const intent = toIntentResult(classification);

        expect(intent.actionType).toBe('mixed');
        expect(intent.entityTypes).toContain('task');
    });

    it('maps future timeframe direction', () => {
        const classification: ClassificationResult = {
            blocked: false,
            category: 'query',
            confidence: 0.9,
            summary: 'what do I have next week?',
            timeframes: [{ label: 'next week', type: 'relative', direction: 'future' }],
            subjects: [],
            attributes: [],
        };
        const intent = toIntentResult(classification);

        expect(intent.timeframe).toBe('future');
    });

    it('maps chat category to query actionType', () => {
        const classification: ClassificationResult = {
            blocked: false,
            category: 'chat',
            confidence: 0.95,
            summary: 'greeting',
            timeframes: [],
            subjects: [],
            attributes: [],
        };
        const intent = toIntentResult(classification);

        expect(intent.actionType).toBe('query');
        expect(intent.isSimple).toBe(true);
    });
});
