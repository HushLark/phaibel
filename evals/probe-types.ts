// Content-type decision probe — runs real persona inputs through the full
// pipeline and records whether Phaibel USED an existing type or CREATED a new
// one, and where the entity landed. Run: npx tsx evals/probe-types.ts
import { createEvalVault, destroyEvalVault } from './vault-setup.js';
import { feralChatHeadless } from '../src/commands/chat.js';
import { loadEntityTypes, invalidateCache } from '../src/entities/entity-type-config.js';
import { listEntities } from '../src/entities/entity.js';
import { resetEntityIndex } from '../src/entities/entity-index.js';

interface Case { persona: 'CEO' | 'VP' | 'Parent'; kind: string; input: string; }

const CASES: Case[] = [
    // ── Humans: generic vs. relationship-specific ─────────────────────────
    { persona: 'VP',     kind: 'human/contact',      input: 'Add Dana Whitman as a contact — VP of Product at Acme.' },
    { persona: 'CEO',    kind: 'human/manager',      input: 'Sam is my manager. We have a weekly 1:1.' },
    { persona: 'VP',     kind: 'human/report',       input: 'Marcus is my direct report on the platform team.' },
    { persona: 'Parent', kind: 'human/child',        input: 'Emma is my daughter, she just turned 8.' },

    // ── Events: generic vs. specific occasion ─────────────────────────────
    { persona: 'CEO',    kind: 'event/meeting',      input: 'I have a board meeting next Thursday at 2pm.' },
    { persona: 'CEO',    kind: 'event/speaking',     input: "I'm giving the keynote at the SaaStr conference on June 20." },
    { persona: 'Parent', kind: 'event/concert',      input: 'I have tickets to the Taylor Swift concert on June 15 at 7pm.' },
    { persona: 'Parent', kind: 'event/school-play',  input: "Jack's school play is next Friday at 6pm in the auditorium." },

    // ── Tasks ─────────────────────────────────────────────────────────────
    { persona: 'VP',     kind: 'task/todo',          input: 'Remind me to review the Q3 revenue forecast.' },
    { persona: 'Parent', kind: 'task/errand',        input: 'I need to pick up Emma\'s prescription from the pharmacy.' },

    // ── Places ────────────────────────────────────────────────────────────
    { persona: 'CEO',    kind: 'place/restaurant',   input: 'Add Tanaka as a go-to spot for client dinners — downtown, great private room.' },
    { persona: 'Parent', kind: 'place/venue',        input: 'Northfield Park is where Emma has soccer practice.' },

    // ── Things: generic note vs. specific record ──────────────────────────
    { persona: 'VP',     kind: 'thing/deal',         input: 'Track the Acme renewal — multi-year, ~$400k ARR, targeting a Q2 close.' },
    { persona: 'Parent', kind: 'thing/medical',      input: 'Important: Emma is allergic to peanuts and carries an EpiPen.' },
    { persona: 'Parent', kind: 'thing/trip',         input: "We're planning a family trip to Hawaii in July." },
];

const timeout = (ms: number) => new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));

async function run() {
    const filter = process.env.PROBE_FILTER;
    const cases = filter ? CASES.filter(c => (c.kind + ' ' + c.input).toLowerCase().includes(filter.toLowerCase())) : CASES;
    for (const c of cases) {
        await createEvalVault([]);
        const before = new Set((await loadEntityTypes()).map(t => t.name));
        let err = '';
        try {
            await Promise.race([
                feralChatHeadless(c.input, () => {}, () => {}, async (_q, o) => (o && o[0]) || '12:00', () => {}, undefined),
                timeout(90_000),
            ]);
        } catch (e) {
            err = e instanceof Error ? e.message : String(e);
        }

        // createAssumedNodes is fire-and-forget — let it settle before snapshot,
        // and don't reset the index (its dedup reads the live index).
        await new Promise(r => setTimeout(r, 2500));
        invalidateCache();
        const afterTypes = await loadEntityTypes();
        const newTypes = afterTypes.map(t => t.name).filter(n => !before.has(n));

        const created: string[] = [];
        for (const tname of new Set(afterTypes.map(t => t.name))) {
            const ents = await listEntities(tname).catch(() => []);
            for (const e of ents) {
                const title = String(e.meta.title ?? e.meta.name ?? '?');
                const rel = e.meta.type ? ` (type=${String(e.meta.type)})` : '';
                created.push(`${tname}:${title}${rel}`);
            }
        }

        const newTypeDetail = afterTypes
            .filter(t => newTypes.includes(t.name))
            .map(t => `${t.name}{base=${t.baseCategory ?? '∅'}${t.parent ? `, parent=${t.parent}` : ''}}`);
        const verdict = newTypes.length > 0 ? `CREATED [${newTypeDetail.join(', ')}]` : 'used existing';
        console.log(`\n■ ${c.persona} ${c.kind}\n  "${c.input}"`);
        console.log(`  → ${verdict}`);
        console.log(`  entities: ${created.join('  ·  ') || '(none)'}${err ? `  [ERR ${err}]` : ''}`);
        await destroyEvalVault();
    }
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
