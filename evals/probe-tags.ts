// Tag value probe — A/B test whether tags markedly improve context-search
// relevance. For each scenario we run the SAME corpus + query twice through the
// real retrieval entry (fetchContextByClassification), once with tags as
// authored and once with every tag stripped, with embeddings synced so the
// semantic channel (buildEmbeddingText joins tags) is live. We measure whether
// the expected target is retrieved (recall@k) and its rank.
// Run: npx tsx evals/probe-tags.ts
import { createEvalVault, destroyEvalVault } from './vault-setup.js';
import { getEntityIndex } from '../src/entities/entity-index.js';
import { getEmbeddingIndex } from '../src/entities/embedding-index.js';
import { loadEntityTypes } from '../src/entities/entity-type-config.js';
import { fetchContextByClassification } from '../src/context/context-loop.js';
import type { ClassificationResult } from '../src/context/request-classifier.js';
import type { VaultSeedEntity } from './types.js';

function classification(over: Partial<ClassificationResult>): ClassificationResult {
    return {
        blocked: false, category: 'query', confidence: 0.9, summary: '',
        timeframes: [], subjects: [], attributes: [], ...over,
    } as ClassificationResult;
}

interface Scenario {
    label: string;
    kind: 'redundant' | 'orthogonal' | 'distractor';
    seed: VaultSeedEntity[];
    c: ClassificationResult;
    target: string;       // substring of the expected target title
    notTarget?: string;   // substring that must NOT lead (distractor)
}

const K = 5;

// strip tags from a seed corpus
function stripTags(seed: VaultSeedEntity[]): VaultSeedEntity[] {
    return seed.map(s => {
        const f = { ...(s.fields ?? {}) };
        delete (f as Record<string, unknown>).tags;
        return { ...s, fields: f };
    });
}

const SCENARIOS: Scenario[] = [
    // ── REDUNDANT: tags echo words already in title/body. Expect no lift. ──
    {
        label: 'redundant: "emma allergic" — tag {allergy} echoes body',
        kind: 'redundant',
        seed: [
            { entityType: 'note', title: "Emma's medical info", body: 'Emma is allergic to peanuts; carries an EpiPen.', fields: { tags: ['medical', 'allergy', 'emma'] } },
            { entityType: 'note', title: 'Packing list', body: 'Sunscreen, chargers, snacks.', fields: { tags: ['travel'] } },
            { entityType: 'note', title: 'Book club picks', body: 'Three novels for spring.', fields: { tags: ['reading'] } },
        ],
        c: classification({ summary: 'what is emma allergic to', subjects: [{ text: 'Emma allergic' }] }),
        target: 'medical info',
    },
    {
        label: 'redundant: "acme renewal" — tag {acme} echoes title',
        kind: 'redundant',
        seed: [
            { entityType: 'task', title: 'Send Acme the renewal quote', fields: { status: 'open', priority: 'high', tags: ['acme', 'renewal', 'sales'] }, body: 'Multi-year renewal.' },
            { entityType: 'task', title: 'Buy printer paper', fields: { status: 'open', priority: 'low', tags: ['office'] } },
            { entityType: 'task', title: 'Plan team offsite', fields: { status: 'open', priority: 'medium', tags: ['team'] } },
        ],
        c: classification({ summary: 'acme renewal', subjects: [{ text: 'Acme renewal' }] }),
        target: 'renewal quote',
    },

    // ── ORTHOGONAL: tag carries a term ABSENT from title+body. Tags' best case. ──
    {
        label: 'orthogonal: query "confidential" matches ONLY a tag',
        kind: 'orthogonal',
        seed: [
            { entityType: 'note', title: 'Q3 planning', body: 'Roadmap priorities and headcount targets.', fields: { tags: ['confidential', 'strategy'] } },
            { entityType: 'note', title: 'Lunch ideas', body: 'Try the new taco place.', fields: { tags: ['food'] } },
            { entityType: 'note', title: 'Weekend chores', body: 'Mow lawn, fix gutter.', fields: { tags: ['home'] } },
        ],
        c: classification({ summary: 'confidential', subjects: [{ text: 'confidential' }] }),
        target: 'Q3 planning',
    },
    {
        label: 'orthogonal: query "vip" matches ONLY a tag on a person',
        kind: 'orthogonal',
        seed: [
            { entityType: 'person', title: 'Dana Whitman', body: 'Product leader at Acme.', fields: { tags: ['vip', 'decision-maker'] } },
            { entityType: 'person', title: 'Sam Rivera', body: 'Engineer on the platform team.', fields: { tags: ['colleague'] } },
            { entityType: 'person', title: 'Pat Lee', body: 'Old college friend.', fields: { tags: ['friend'] } },
        ],
        c: classification({ summary: 'vip', subjects: [{ text: 'vip' }] }),
        target: 'Dana Whitman',
    },

    // ── DISTRACTOR: does a tag cause an off-topic node to leak/lead? ──
    {
        label: 'distractor: off-topic note tagged with the query term',
        kind: 'distractor',
        seed: [
            { entityType: 'note', title: 'Marathon training plan', body: 'Weekly mileage and pace targets for the fall marathon.', fields: { tags: ['fitness'] } },
            { entityType: 'note', title: 'Tax documents', body: 'Where the 2025 receipts are filed.', fields: { tags: ['marathon'] } }, // misleading tag
        ],
        c: classification({ summary: 'marathon training', subjects: [{ text: 'marathon training' }] }),
        target: 'Marathon training plan',
        notTarget: 'Tax documents',
    },
];

interface RunResult { found: boolean; rank: number; titles: string[] }

async function runOnce(seed: VaultSeedEntity[], c: ClassificationResult, target: string): Promise<RunResult> {
    await createEvalVault(seed);
    const idx = getEntityIndex();
    await idx.build();
    const emb = getEmbeddingIndex();
    await emb.load();
    try { await emb.sync(idx); } catch (e) { /* model unavailable — semantic channel inert */ }
    const types = await loadEntityTypes();
    const gathered = await fetchContextByClassification(c, {}, idx, types);
    const titles = gathered.nodes.map(n => String(n.meta.title ?? n.title));
    const rank = titles.findIndex(t => t.toLowerCase().includes(target.toLowerCase()));
    await destroyEvalVault();
    return { found: rank >= 0 && rank < K, rank: rank < 0 ? Infinity : rank + 1, titles };
}

async function main() {
    let embAvailable = false;
    {
        // quick check whether the embedding model loads at all
        await createEvalVault([{ entityType: 'note', title: 'probe', body: 'probe', fields: {} }]);
        const idx = getEntityIndex(); await idx.build();
        const emb = getEmbeddingIndex(); await emb.load();
        try { await emb.sync(idx); embAvailable = emb.isLoaded && Object.keys((emb as any).store?.entries ?? {}).length > 0; } catch { embAvailable = false; }
        await destroyEvalVault();
    }
    console.log(`semantic channel (embeddings): ${embAvailable ? 'ACTIVE' : 'INERT (model unavailable — keyword channel only)'}\n`);

    let changed = 0;
    for (const s of SCENARIOS) {
        const withTags = await runOnce(s.seed, s.c, s.target);
        const noTags = await runOnce(stripTags(s.seed), s.c, s.target);

        const rankStr = (r: RunResult) => `${r.found ? `#${r.rank}` : 'MISS'}`;
        const delta = withTags.found !== noTags.found || withTags.rank !== noTags.rank;
        if (delta) changed++;

        // distractor leak check
        let leakNote = '';
        if (s.notTarget) {
            const leak = (r: RunResult) => r.titles.slice(0, K).some(t => t.toLowerCase().includes(s.notTarget!.toLowerCase()));
            leakNote = `  | distractor leak: withTags=${leak(withTags)} noTags=${leak(noTags)}`;
        }

        console.log(`■ [${s.kind}] ${s.label}`);
        console.log(`   target "${s.target}":  withTags=${rankStr(withTags)}   noTags=${rankStr(noTags)}   ${delta ? '◆ CHANGED' : '= same'}${leakNote}`);
        console.log(`   withTags top${K}: [${withTags.titles.slice(0, K).join(' | ')}]`);
        console.log(`   noTags   top${K}: [${noTags.titles.slice(0, K).join(' | ')}]\n`);
    }

    console.log(`\n── SUMMARY ──`);
    console.log(`scenarios where removing tags changed retrieval/rank: ${changed}/${SCENARIOS.length}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
