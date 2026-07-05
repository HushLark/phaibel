/**
 * Zero-result rescue — a wrong subject entityType from the classifier must
 * never zero out retrieval when the answer lives in a different type.
 * (The "mom's birthday lives in a note, not a person" bug.)
 */
import { describe, it, expect } from 'vitest';
import { buildFetchRequests, buildBroadFallbackRequests } from '../../src/context/request-weights.js';
import type { ClassificationResult } from '../../src/context/request-classifier.js';

const classification = (subjects: ClassificationResult['subjects']): ClassificationResult => ({
    category: 'query',
    confidence: 0.95,
    summary: "user wants mom's birthday and gift preferences",
    timeframes: [],
    subjects,
    attributes: [],
} as unknown as ClassificationResult);

describe('retrieval fallback requests', () => {
    it('typed subjects also get an untyped cross-type companion request', () => {
        const reqs = buildFetchRequests(classification([{ text: 'mom', entityType: 'person' }] as never));
        expect(reqs.some(r => r.entityType === 'person')).toBe(true);
        expect(reqs.some(r => !r.entityType)).toBe(true); // untyped recall companion
    });

    it('broad fallback covers core types plus a cross-type summary pass', () => {
        const reqs = buildBroadFallbackRequests(classification([]));
        const types = reqs.map(r => r.entityType);
        for (const t of ['task', 'event', 'goal', 'note', 'person']) {
            expect(types).toContain(t);
        }
        expect(reqs.some(r => !r.entityType && r.query.length > 0)).toBe(true);
    });

    it('empty subjects fall through to the broad fallback in buildFetchRequests', () => {
        const reqs = buildFetchRequests(classification([]));
        expect(reqs.length).toBeGreaterThanOrEqual(5);
        expect(reqs.some(r => r.entityType === 'note')).toBe(true);
    });
});
