import { describe, it, expect } from 'vitest';
import { scoreNodes, type ScorerContext } from '../../src/cxms/relevance-scorer.js';
import type { IndexNode, IndexEdge } from '../../src/entities/entity-index.js';
import type { RelevanceDimensionDef } from '../../src/entities/entity-type-config.js';

function node(type: string, id: string, meta: Record<string, unknown> = {}): IndexNode {
    return {
        id, type, name: id, title: id, filepath: '', tags: [],
        description: '', summary: '', bodySnippet: '', meta,
    } as unknown as IndexNode;
}

function baseCtx(over: Partial<ScorerContext> = {}): ScorerContext {
    return {
        vectorSimilarity: new Map(),
        edges: [],
        anchorKeys: new Set(),
        now: new Date('2026-06-20T00:00:00Z'),
        today: '2026-06-20',
        ...over,
    };
}

const link = (source: string, target: string, label?: string): IndexEdge =>
    ({ source, target, edgeType: 'link', label });

describe('scoreNodes', () => {
    it('ranks by semantic similarity when semantic is the only dimension', () => {
        const dims: RelevanceDimensionDef[] = [{ type: 'semantic' }];
        const a = node('note', 'a');
        const b = node('note', 'b');
        const ctx = baseCtx({ vectorSimilarity: new Map([['note:a', 0.9], ['note:b', 0.1]]) });
        const ranked = scoreNodes([b, a], dims, ctx);
        expect(ranked[0].key).toBe('note:a');
        expect(ranked[0].total).toBeGreaterThan(ranked[1].total);
    });

    it('social proximity is anchored on the "me" node (closer to me ranks higher)', () => {
        const dims: RelevanceDimensionDef[] = [{ type: 'socialProximity' }];
        const a = node('person', 'a');
        const b = node('person', 'b');
        const ctx = baseCtx({
            edges: [link('person:me', 'person:a')], // a is 1 hop from me; b unreachable
            focalNodeKey: 'person:me',
        });
        const ranked = scoreNodes([a, b], dims, ctx);
        expect(ranked.find(r => r.key === 'person:a')!.signals.socialProximity).toBeGreaterThan(0);
        expect(ranked.find(r => r.key === 'person:b')!.signals.socialProximity).toBe(0);
    });

    it('context proximity is anchored on the current query anchors (not "me")', () => {
        const dims: RelevanceDimensionDef[] = [{ type: 'contextProximity' }];
        const a = node('task', 'a');
        const b = node('task', 'b');
        const ctx = baseCtx({
            edges: [link('project:acme', 'task:a')], // a is linked to the anchor; b is not
            anchorKeys: new Set(['project:acme']),
        });
        const ranked = scoreNodes([a, b], dims, ctx);
        expect(ranked[0].key).toBe('task:a');
        expect(ranked.find(r => r.key === 'task:b')!.signals.contextProximity).toBe(0);
    });

    it('temporal dimension uses the salience curve (in-window beats archived)', () => {
        const dims: RelevanceDimensionDef[] = [{ type: 'temporal' }];
        const inWindow = node('event', 'soon', {
            dimensions: { temporal: { anchor: 'point', start: '2026-06-20', relevantStart: '2026-06-18', relevantEnd: '2026-06-27', archiveAfter: '2026-07-04' } },
        });
        const archived = node('event', 'old', {
            dimensions: { temporal: { anchor: 'point', start: '2026-01-01', relevantStart: '2025-12-30', relevantEnd: '2026-01-08', archiveAfter: '2026-01-15' } },
        });
        const ranked = scoreNodes([archived, inWindow], dims, baseCtx());
        // Temporal is a candidacy filter: the archived (zero-salience) node is
        // excluded outright, not merely ranked last.
        expect(ranked).toHaveLength(1);
        expect(ranked[0].key).toBe('event:soon');
        expect(ranked.find(r => r.key === 'event:old')).toBeUndefined();
    });

    it('request-weight multipliers re-weight the blend', () => {
        const dims: RelevanceDimensionDef[] = [{ type: 'semantic' }, { type: 'socialProximity' }];
        const semantic = node('person', 'semantic'); // strong semantic, far socially
        const social = node('person', 'social');      // weak semantic, close to me
        const ctx = baseCtx({
            vectorSimilarity: new Map([['person:semantic', 0.9], ['person:social', 0.2]]),
            edges: [link('person:me', 'person:social')],
            focalNodeKey: 'person:me',
        });

        const neutral = scoreNodes([semantic, social], dims, ctx);
        // Amplifying social proximity ×3 should lift the socially-close node's score.
        const boosted = scoreNodes([semantic, social], dims, ctx, { socialProximity: 3, semantic: 1 });

        const socialNeutral = neutral.find(r => r.key === 'person:social')!.total;
        const socialBoosted = boosted.find(r => r.key === 'person:social')!.total;
        expect(socialBoosted).toBeGreaterThan(socialNeutral);
    });

    it('normalizes free-form relationship values onto weight buckets', () => {
        // No "me" graph path → social proximity falls back to the relationship
        // weight. The LLM writes free-form values ("daughter", "direct_report"),
        // which must map to family (1.0) > colleague (0.5).
        const dims: RelevanceDimensionDef[] = [{ type: 'socialProximity', config: { field: 'type' } }];
        const daughter = node('person', 'kid', { type: 'daughter' });
        const report = node('person', 'report', { type: 'direct_report' });
        const ctx = baseCtx(); // no focalNodeKey → relationship-weight only
        const ranked = scoreNodes([report, daughter], dims, ctx);
        expect(ranked[0].key).toBe('person:kid');
        expect(ranked.find(r => r.key === 'person:kid')!.signals.socialProximity)
            .toBeGreaterThan(ranked.find(r => r.key === 'person:report')!.signals.socialProximity);
    });

    it('returns no scores when the type declares no dimensions', () => {
        expect(scoreNodes([node('note', 'a')], [], baseCtx())).toEqual([]);
    });
});
