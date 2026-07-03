/**
 * Dimension scoring — accuracy vs completeness classification and math.
 */
import { describe, it, expect } from 'vitest';
import { evaluateAssertions, computeDimensionScores, computeScore } from '../../evals/assertions.js';
import type { EvalAssertion, VaultSnapshot } from '../../evals/types.js';

const entity = (title: string, meta: Record<string, unknown> = {}, body = '') => ({
    title,
    meta,
    body,
});

describe('dimension classification', () => {
    it('classifies a duplicate write as an accuracy failure, not completeness', async () => {
        const before: VaultSnapshot = { task: [] };
        const after: VaultSnapshot = { task: [entity('Buy milk'), entity('Buy milk again')] };
        const assertions: EvalAssertion[] = [
            { type: 'entity_created', entityType: 'task', titleMatch: 'milk', description: 'task created' },
            { type: 'entity_count', entityType: 'task', expected: 1, description: 'exactly one task' },
            { type: 'response_not_contains', match: 'error', description: 'no error surfaced' },
        ];
        const results = await evaluateAssertions(assertions, before, after, 'Added Buy milk.');
        const { accuracy, completeness } = computeDimensionScores(assertions, results);
        expect(completeness).toBe(1);  // the asked-for task exists (count failure was accuracy's fault)
        expect(accuracy).toBe(0.5);    // count check failed (dup write); not_contains passed
    });

    it('classifies missing work as a completeness failure, not accuracy', async () => {
        const before: VaultSnapshot = { task: [] };
        const after: VaultSnapshot = { task: [] };
        const assertions: EvalAssertion[] = [
            { type: 'entity_created', entityType: 'task', titleMatch: 'milk', description: 'task created' },
            { type: 'entity_count', entityType: 'task', expected: 1, description: 'exactly one task' },
            { type: 'response_not_contains', match: 'error', description: 'no error surfaced' },
        ];
        const results = await evaluateAssertions(assertions, before, after, 'Done!');
        const { accuracy, completeness } = computeDimensionScores(assertions, results);
        expect(accuracy).toBe(1);       // nothing wrong was done
        expect(completeness).toBe(0);   // nothing asked-for was done
    });

    it('entity_field: wrong value hits accuracy, absent value hits completeness', async () => {
        const before: VaultSnapshot = { task: [] };
        const wrongValue: VaultSnapshot = { task: [entity('Buy milk', { priority: 'low' })] };
        const absent: VaultSnapshot = { task: [entity('Buy milk', {})] };
        const assertions: EvalAssertion[] = [
            { type: 'entity_field', entityType: 'task', titleMatch: 'milk', field: 'priority', expected: 'high', description: 'priority high' },
        ];

        const wrongResults = await evaluateAssertions(assertions, before, wrongValue, '');
        expect(wrongResults[0].failedDimension).toBe('accuracy');

        const absentResults = await evaluateAssertions(assertions, before, absent, '');
        expect(absentResults[0].failedDimension).toBe('completeness');
    });

    it('respects an explicit dimension override', async () => {
        const assertions: EvalAssertion[] = [
            { type: 'response_contains', match: 'paris', description: 'claims correctness, not presence', dimension: 'accuracy' },
        ];
        const results = await evaluateAssertions(assertions, {}, {}, 'The capital is London');
        expect(results[0].dimensions).toEqual(['accuracy']);
        expect(results[0].failedDimension).toBe('accuracy');
        const { accuracy, completeness } = computeDimensionScores(assertions, results);
        expect(accuracy).toBe(0);
        expect(completeness).toBe(1); // no completeness-relevant assertions → vacuously complete
    });

    it('grants fractional credit from judged scores', () => {
        const assertions: EvalAssertion[] = [
            { type: 'response_faithful', description: 'claims supported' },
        ];
        const results = [{
            description: 'claims supported', type: 'response_faithful',
            passed: false, score: 0.75,
            dimensions: ['accuracy' as const], failedDimension: 'accuracy' as const,
            message: '3/4 claims supported',
        }];
        const { accuracy } = computeDimensionScores(assertions, results);
        expect(accuracy).toBe(0.75);
        expect(computeScore(assertions, results)).toBe(0.75);
    });

    it('debits both dimensions when an assertion throws', () => {
        const assertions: EvalAssertion[] = [
            { type: 'entity_created', entityType: 'task', titleMatch: 'x', description: 'a' },
        ];
        const results = [{
            description: 'a', type: 'entity_created', passed: false,
            dimensions: ['accuracy' as const, 'completeness' as const],
            message: 'Assertion threw: boom',
        }];
        const { accuracy, completeness } = computeDimensionScores(assertions, results);
        expect(accuracy).toBe(0);
        expect(completeness).toBe(0);
    });

    it('weights carry into dimension scores', async () => {
        const before: VaultSnapshot = { task: [] };
        const after: VaultSnapshot = { task: [entity('A'), entity('B'), entity('Unwanted')] };
        const assertions: EvalAssertion[] = [
            { type: 'entity_created', entityType: 'task', titleMatch: 'A', description: 'A created', weight: 1 },
            { type: 'entity_not_created', entityType: 'task', titleMatch: 'unwanted', description: 'no junk', weight: 3 },
        ];
        const results = await evaluateAssertions(assertions, before, after, '');
        const { accuracy, completeness } = computeDimensionScores(assertions, results);
        expect(completeness).toBe(1);
        expect(accuracy).toBe(0); // the only accuracy-relevant assertion (w=3) failed
    });
});
