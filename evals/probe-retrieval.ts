// Deterministic retrieval probe — feeds synthetic classifications into the real
// fetch path (no LLM) to find where entities get dropped. Run: npx tsx evals/probe-retrieval.ts
import { createEvalVault, destroyEvalVault } from './vault-setup.js';
import { getEntityIndex } from '../src/entities/entity-index.js';
import { loadEntityTypes } from '../src/entities/entity-type-config.js';
import { fetchContextByClassification } from '../src/context/context-loop.js';
import { ensureSelfPerson } from '../src/state/manager.js';
import { listEntities } from '../src/entities/entity.js';
import type { ClassificationResult } from '../src/context/request-classifier.js';
import type { VaultSeedEntity } from './types.js';

function classification(over: Partial<ClassificationResult>): ClassificationResult {
    return {
        blocked: false, category: 'query', confidence: 0.9, summary: '',
        timeframes: [], subjects: [], attributes: [], ...over,
    } as ClassificationResult;
}

const day = (o: number) => { const d = new Date(); d.setDate(d.getDate() + o); return d.toISOString().slice(0, 10); };

async function probe(label: string, seed: VaultSeedEntity[], c: ClassificationResult, expectTitles: string[], notExpect: string[] = [], expectFirst?: string) {
    await createEvalVault(seed);
    const idx = getEntityIndex();
    await idx.build();
    const types = await loadEntityTypes();
    const gathered = await fetchContextByClassification(c, {}, idx, types);
    const titles = gathered.nodes.map(n => String(n.meta.title ?? n.title));
    const got = (t: string) => titles.some(x => x.toLowerCase().includes(t.toLowerCase()));
    const hitsOk = expectTitles.every(got);
    const missOk = notExpect.every(t => !got(t));
    const firstOk = !expectFirst || (titles[0]?.toLowerCase().includes(expectFirst.toLowerCase()) ?? false);
    console.log(`\n[${hitsOk && missOk && firstOk ? 'PASS' : 'FAIL'}] ${label}`);
    console.log(`   retrieved ${gathered.nodes.length}: [${titles.join(' | ')}]`);
    if (!hitsOk) console.log(`   MISSING: ${expectTitles.filter(t => !got(t)).join(', ')}`);
    if (!missOk) console.log(`   LEAKED:  ${notExpect.filter(got).join(', ')}`);
    if (!firstOk) console.log(`   EXPECTED FIRST: ${expectFirst} (got "${titles[0] ?? '∅'}")`);
    await destroyEvalVault();
}

async function main() {
    // 1. Cross-type miss: factual question routed to the wrong type
    await probe(
        'cross-type: "Emma allergic" with subject typed as person → should still find the NOTE',
        [
            { entityType: 'note', title: "Emma's medical info", body: 'Emma is allergic to peanuts.' },
            { entityType: 'note', title: 'Packing list', body: 'Sunscreen, chargers.' },
        ],
        classification({ summary: 'what is emma allergic to', subjects: [{ text: 'Emma', entityType: 'person' }] }),
        ['medical info'], ['Packing'],
    );

    // 2. Untyped subject → cross-type keyword should find the note
    await probe(
        'untyped subject "Emma" → cross-type keyword finds the note',
        [{ entityType: 'note', title: "Emma's medical info", body: 'Emma is allergic to peanuts.' }],
        classification({ summary: 'emma allergy', subjects: [{ text: 'Emma' }] }),
        ['medical info'],
    );

    // 3. Temporal ranking: near event should rank/surface over far
    await probe(
        'temporal: "events this week" → near event surfaces',
        [
            { entityType: 'event', title: 'Acme renewal call', fields: { startDate: `${day(2)}T11:30:00` } },
            { entityType: 'event', title: 'Sales kickoff', fields: { startDate: `${day(85)}T09:00:00` } },
        ],
        classification({ summary: 'events this week', subjects: [{ text: 'events', entityType: 'event' }], timeframes: [{ label: 'this week', type: 'relative', direction: 'present' }] }),
        ['Acme renewal call'],
    );

    // 4. No subjects at all → fallback should still gather something
    await probe(
        'no subjects → fallback fetch returns entities',
        [{ entityType: 'task', title: 'Review the board deck', fields: { status: 'open', priority: 'high' } }],
        classification({ summary: 'what should I do', subjects: [] }),
        ['board deck'],
    );

    // 5. Temporal FILTER (trailing side): a past/archived event is excluded;
    //    an upcoming far-future event is kept (ranked low, not dropped).
    await probe(
        'temporal filter: expired event excluded, upcoming event kept',
        [
            { entityType: 'event', title: 'Acme renewal call', fields: { startDate: `${day(2)}T11:30:00` } },
            { entityType: 'event', title: 'Sales kickoff', fields: { startDate: `${day(85)}T09:00:00` } },
            { entityType: 'event', title: 'Old planning sync', fields: { startDate: `${day(-50)}T09:00:00` } },
        ],
        classification({ summary: 'events', subjects: [{ text: 'events', entityType: 'event' }] }),
        ['Acme renewal call', 'Sales kickoff'], ['Old planning sync'],
    );

    // 6. Context proximity: a task graph-linked to the queried project should
    //    surface over an unrelated task.
    await probe(
        'context proximity: Acme-linked task surfaces, unrelated task does not lead',
        [
            { entityType: 'company', title: 'Acme Corp', body: 'Renewal in progress.' },
            { entityType: 'task', title: 'Send Acme the renewal quote', fields: { status: 'open', priority: 'high' }, body: 'For [[Acme Corp]].' },
            { entityType: 'task', title: 'Buy printer paper', fields: { status: 'open', priority: 'low' } },
        ],
        classification({ summary: 'Acme', subjects: [{ text: 'Acme', entityType: 'company' }] }),
        ['Acme'],
    );

    // 7. Over-filtering guard: a task due far in the future is still an open work
    //    item and must NOT be filtered out of "my tasks".
    await probe(
        'temporal filter does not drop a far-future open task',
        [
            { entityType: 'task', title: 'Renew passport', fields: { status: 'open', priority: 'medium', dueDate: day(200) } },
            { entityType: 'task', title: 'Reply to Dana', fields: { status: 'open', priority: 'high', dueDate: day(1) } },
        ],
        classification({ summary: 'tasks', subjects: [{ text: 'tasks', entityType: 'task' }] }),
        ['Renew passport', 'Reply to Dana'],
    );

    // 7b. Specificity: a more-specific type (immediate_family) outranks an
    //     equally-relevant generic person in the merged, score-sorted fetch.
    await probe(
        'specificity: immediate_family ranks above generic person',
        [
            { entityType: 'person', title: 'Riley Brooks', body: 'A contact named Riley.' },
            { entityType: 'immediate_family', title: 'Riley Carter', fields: { type: 'family', relation: 'sister' }, body: 'My sister Riley.' },
        ],
        // Untyped subject so both types are fetched cross-type and merged.
        classification({ summary: 'Riley', subjects: [{ text: 'Riley' }] }),
        ['Riley Carter'], [], 'Riley Carter',
    );

    // 8. Me-node: onboarding (ensureSelfPerson) creates a resolvable "me" node —
    //    the anchor for social/user proximity — and is idempotent.
    {
        await createEvalVault([]);
        await ensureSelfPerson('Gary', 'male');
        await ensureSelfPerson('Gary', 'male'); // second call must not duplicate
        const idx = getEntityIndex();
        await idx.build();
        const me = idx.getMeNode();
        const people = await listEntities('person');
        const ok = !!me && people.length === 1;
        console.log(`\n[${ok ? 'PASS' : 'FAIL'}] me-node: ensureSelfPerson → getMeNode resolves, idempotent`);
        console.log(`   getMeNode: ${me ? (me.meta.title ?? me.name) : 'null'} | person count: ${people.length}`);
        await destroyEvalVault();
    }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
