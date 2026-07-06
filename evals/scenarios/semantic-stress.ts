/**
 * Semantic Stress Scenarios
 *
 * Tests relevance retrieval at production vault scale, in the regime where
 * keyword matching genuinely fails: the query is a PARAPHRASE of the target
 * content (near-zero content-word overlap), a keyword-bait distractor shares
 * surface words with the query but is wrong, and ~120 filler entities create
 * ranking pressure against the maxNodes context cap.
 *
 * Purpose: decide whether the mobile app needs an on-device semantic
 * embedding component. Run with embeddings on vs off (mobile emulation):
 *   PHAIBEL_DISABLE_LOCAL_EMBED=0 tsx evals/run-eval.ts --mobile --filter …
 */
import type { EvalScenario, VaultSeedEntity } from '../types.js';

// Deterministic filler — bland, keyword-neutral content across core types.
// Topics deliberately avoid every target/distractor content word.
const FILLER_TOPICS = [
    'quarterly roadmap review', 'sprint retro follow-ups', 'design system tokens',
    'invoice reconciliation', 'onboarding checklist updates', 'vendor comparison spreadsheet',
    'team offsite logistics', 'newsletter draft outline', 'budget variance summary',
    'hiring pipeline notes', 'API deprecation timeline', 'customer interview themes',
    'metrics dashboard cleanup', 'release notes draft', 'support ticket triage',
    'brand refresh feedback', 'compliance training reminder', 'infrastructure cost review',
    'partner sync agenda', 'documentation gaps list', 'accessibility audit items',
    'localization glossary', 'sales enablement deck', 'community forum moderation',
];

function filler(count: number, prefix: string): VaultSeedEntity[] {
    const out: VaultSeedEntity[] = [];
    for (let k = 0; k < count; k++) {
        const topic = FILLER_TOPICS[k % FILLER_TOPICS.length];
        const n = Math.floor(k / FILLER_TOPICS.length) + 1;
        if (k % 4 === 3) {
            out.push({
                entityType: 'task',
                title: `${prefix} ${topic} pass ${n}`,
                fields: { status: 'open', priority: 'medium' },
                body: `Follow up on the ${topic} before the next working session. Round ${n}.`,
            });
        } else {
            out.push({
                entityType: 'note',
                title: `${prefix} ${topic} ${n}`,
                body: `Working notes on the ${topic}. Round ${n}: reviewed progress, captured open questions, assigned owners for the remaining follow-ups.`,
            });
        }
    }
    return out;
}

export const semanticStressScenarios: EvalScenario[] = [
    {
        id: 'sem-paraphrase-health',
        name: 'Paraphrase recall: stomach trouble → lactose note, not the workout distractor',
        category: 'semantic-stress',
        timeoutSeconds: 120,
        userInput: "What did I figure out about my stomach problems?",
        vaultSeed: [
            {
                entityType: 'note',
                title: 'Digestion journal conclusions',
                body: 'After three weeks of tracking: lactose is the culprit. Cutting milk and cheese eliminated the discomfort almost entirely.',
            },
            {
                entityType: 'note',
                title: 'Stomach workout plan',
                body: 'Core routine: crunches 3x15, plank 60s, leg raises 3x12. Increase reps weekly.',
            },
            ...filler(120, 'W'),
        ],
        assertions: [
            { type: 'response_contains', match: 'lactose', description: 'The paraphrased answer (lactose finding) must surface' },
            { type: 'response_not_contains', match: 'crunches', description: 'The keyword-bait workout note must not be presented as the answer' },
            { type: 'response_faithful', description: 'No fabricated health claims' },
        ],
    },
    {
        id: 'sem-paraphrase-car',
        name: 'Paraphrase recall: car noise → brake pads note',
        category: 'semantic-stress',
        timeoutSeconds: 120,
        userInput: 'Where did I write down what that noise in the car was?',
        vaultSeed: [
            {
                entityType: 'note',
                title: 'Garage visit summary',
                body: 'Mechanic diagnosed the grinding when slowing down: worn front brake pads. Quoted $280 fitted, parts in on Thursday.',
            },
            {
                entityType: 'task',
                title: 'Book car wash and noise-cancelling headphones return',
                fields: { status: 'open', priority: 'low' },
                body: 'Wash the car before the trip; return the noisy headphones to the shop.',
            },
            ...filler(120, 'X'),
        ],
        assertions: [
            { type: 'response_contains', match: 'brake', description: 'The brake-pad diagnosis must surface' },
            { type: 'response_not_contains', match: 'headphones', description: 'The keyword-bait (noise/car) task must not be presented as the answer' },
        ],
    },
    {
        id: 'sem-paraphrase-gift',
        name: 'Paraphrase recall: anniversary present → pottery workshop idea',
        category: 'semantic-stress',
        timeoutSeconds: 120,
        userInput: 'Any ideas for what to get for our anniversary?',
        vaultSeed: [
            {
                entityType: 'note',
                title: 'Milestone celebration thoughts',
                body: 'Sarah lit up talking about the pottery class she tried — a weekend wheel-throwing workshop for two would be a perfect present.',
            },
            {
                entityType: 'event',
                title: 'Anniversary of company founding gala',
                fields: { startDate: '2026-09-15T18:00:00-06:00' },
                body: 'Black tie optional. RSVP by September 1.',
            },
            ...filler(120, 'Y'),
        ],
        assertions: [
            { type: 'response_contains', match: 'pottery', description: 'The gift idea (pottery workshop) must surface' },
            { type: 'response_not_contains', match: 'gala', description: 'The keyword-bait company-anniversary event must not be the answer' },
        ],
    },
    {
        id: 'sem-paraphrase-decision',
        name: 'Paraphrase recall: why this database → ADR note',
        category: 'semantic-stress',
        timeoutSeconds: 120,
        userInput: 'Remind me why we went with the database we use?',
        vaultSeed: [
            {
                entityType: 'note',
                title: 'Architecture decision record 007',
                body: 'Selected Postgres over document stores: transactional guarantees and mature migrations tooling outweighed schema flexibility. Revisit if document-shaped workloads dominate.',
            },
            {
                entityType: 'task',
                title: 'Return database systems book to library',
                fields: { status: 'open', priority: 'low' },
                body: 'Due back Friday.',
            },
            ...filler(120, 'Z'),
        ],
        assertions: [
            { type: 'response_contains', match: 'Postgres', description: 'The ADR rationale must surface' },
            { type: 'response_not_contains', match: 'library', description: 'The keyword-bait book task must not be the answer' },
        ],
    },
    {
        id: 'sem-paraphrase-trip',
        name: 'Paraphrase recall: summer plans → cottage note',
        category: 'semantic-stress',
        timeoutSeconds: 120,
        userInput: "What's the plan for our getaway this summer?",
        vaultSeed: [
            {
                entityType: 'note',
                title: 'July escape logistics',
                body: 'Cottage on Lake Michigan booked for the last week of July. Ferry tickets confirmed; dog boarding still to arrange.',
            },
            {
                entityType: 'task',
                title: 'Swap summer tires and plan sprinkler schedule',
                fields: { status: 'open', priority: 'medium' },
                body: 'Garage appointment needed before it gets hot.',
            },
            ...filler(120, 'V'),
        ],
        assertions: [
            { type: 'response_contains', match: 'cottage', description: 'The cottage plan must surface' },
            { type: 'response_not_contains', match: 'tires', description: 'The keyword-bait (summer) task must not be the answer' },
            { type: 'response_faithful', description: 'No invented trip details' },
        ],
    },
    {
        id: 'sem-needle-scale',
        name: 'Needle at scale: recall an exact detail from one note among 150',
        category: 'semantic-stress',
        timeoutSeconds: 120,
        userInput: 'How do I get online when we are up at the lake place?',
        vaultSeed: [
            {
                entityType: 'note',
                title: 'Lakehouse practicalities',
                body: 'Router is in the hall closet; network password is trout-river-42. Water shutoff is under the porch.',
            },
            ...filler(150, 'U'),
        ],
        assertions: [
            { type: 'response_contains', match: 'trout-river-42', description: 'The exact password must be recalled from one note among 150' },
        ],
    },
];
