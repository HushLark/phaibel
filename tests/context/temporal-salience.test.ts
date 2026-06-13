import { describe, it, expect } from 'vitest';
import { temporalSalience, temporalExpired } from '../../src/entities/temporal-filter.js';
import type { TemporalNodeDimension } from '../../src/cxms/types.js';

// Period event: 1-day event on 2026-06-20, windowBefore 7, windowAfter 7, archiveDelay 7.
const event: TemporalNodeDimension = {
    anchor: 'period',
    start: '2026-06-20',
    end: '2026-06-20',
    relevantStart: '2026-06-13',
    relevantEnd: '2026-06-27',
    archiveAfter: '2026-07-04',
};

// Point task: due 2026-06-20, windowBefore 2, windowAfter 7 (overdue grace), archiveDelay 7.
const task: TemporalNodeDimension = {
    anchor: 'point',
    start: '2026-06-20',
    relevantStart: '2026-06-18',
    relevantEnd: '2026-06-27',
    archiveAfter: '2026-07-04',
};

describe('temporalSalience', () => {
    it('is timeless (1) for a node with no temporal dimension', () => {
        expect(temporalSalience(undefined, '2020-01-01')).toBe(1);
    });

    it('is 0 before the relevance window opens', () => {
        expect(temporalSalience(event, '2026-06-10')).toBe(0);
    });

    it('ramps up linearly during the attack phase', () => {
        // 2026-06-16 is 3 of 7 days into the attack [06-13, 06-20]
        expect(temporalSalience(event, '2026-06-16')).toBeCloseTo(3 / 7, 5);
    });

    it('peaks at 1 during the event', () => {
        expect(temporalSalience(event, '2026-06-20')).toBe(1);
    });

    it('decays linearly after the event toward the archive point', () => {
        // peakEnd 06-20, zero 07-04 (14 days); 06-27 is 7 days in → 0.5
        expect(temporalSalience(event, '2026-06-27')).toBeCloseTo(0.5, 5);
    });

    it('is 0 at and after the archive point', () => {
        expect(temporalSalience(event, '2026-07-04')).toBe(0);
        expect(temporalSalience(event, '2026-07-20')).toBe(0);
    });

    it('keeps an overdue task at full salience through its grace window', () => {
        expect(temporalSalience(task, '2026-06-20')).toBe(1); // due
        expect(temporalSalience(task, '2026-06-25')).toBe(1); // overdue, still hot
        expect(temporalSalience(task, '2026-06-27')).toBe(1); // end of grace
    });

    it('decays an overdue task only after its grace window', () => {
        // peakEnd 06-27, zero 07-04 (7 days); 06-30 is 3 days in → ~0.571
        expect(temporalSalience(task, '2026-06-30')).toBeCloseTo(1 - 3 / 7, 5);
    });
});

describe('temporalExpired (trailing-side candidacy filter)', () => {
    it('an undated node never expires', () => {
        expect(temporalExpired(undefined, '2099-01-01')).toBe(false);
    });

    it('an upcoming event (before its window opens) is NOT expired', () => {
        // far before relevantStart → salience 0 but still a valid candidate
        expect(temporalSalience(event, '2026-06-01')).toBe(0);
        expect(temporalExpired(event, '2026-06-01')).toBe(false);
    });

    it('a far-future task is not expired (stays in "my tasks")', () => {
        expect(temporalExpired(task, '2026-01-01')).toBe(false);
    });

    it('a node past its archive point is expired', () => {
        expect(temporalExpired(event, '2026-07-04')).toBe(true);
        expect(temporalExpired(event, '2026-08-01')).toBe(true);
    });
});
