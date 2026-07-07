/**
 * People Workflow Scenarios
 *
 * The dominant real-world pattern for person entities: quick-add one or many
 * people with minimal detail, then refine their records over later turns.
 *
 * Born from a real on-device failure (2026-07-06): the identity-lookup
 * semantic fallback matched "Jeremy" → the user's own ME node at 0.42
 * similarity, so a three-person quick-add produced zero new people and
 * serially renamed the user's profile entity instead. Every scenario here
 * seeds a real ME node and asserts it survives untouched.
 */
import type { EvalScenario } from '../types.js';

const ME_SEED = {
    entityType: 'person',
    title: 'Gary Tester',
    fields: { id: 'ME000000', isMe: true },
    body: 'The vault owner.',
};

const QUICK_ADD_HISTORY = [
    { role: 'user' as const, content: 'Remember three people: Jeremy my business partner, Ben a senior engineer on my team, and Kate our designer' },
    { role: 'assistant' as const, content: "Done — I've added Jeremy (business partner), Ben (senior engineer), and Kate (designer)." },
];

const SPARSE_PEOPLE_SEED = [
    ME_SEED,
    { entityType: 'person', title: 'Jeremy', body: 'Business partner.' },
    { entityType: 'person', title: 'Ben', body: 'Senior engineer.' },
    { entityType: 'person', title: 'Kate', body: 'Designer.' },
];

export const peopleWorkflowScenarios: EvalScenario[] = [
    {
        id: 'quick-add-three-people',
        name: 'Quick-add three people in one message',
        category: 'people-workflow',
        userInput: 'Remember three people: Jeremy my business partner, Ben a senior engineer on my team, and Kate our designer',
        vaultSeed: [ME_SEED],
        assertions: [
            { type: 'entity_created', entityType: 'person', titleMatch: 'Jeremy', description: 'A person should be created for Jeremy' },
            { type: 'entity_created', entityType: 'person', titleMatch: 'Ben', description: 'A person should be created for Ben' },
            { type: 'entity_created', entityType: 'person', titleMatch: 'Kate', description: 'A person should be created for Kate' },
            { type: 'entity_count', entityType: 'person', expected: 4, description: 'Exactly 4 persons: the owner + the 3 new people (no dupes, no lost owner)' },
            { type: 'entity_field', entityType: 'person', titleMatch: 'Gary', field: 'name', expected: 'Gary Tester', dimension: 'accuracy', description: 'The ME node must NOT be renamed or overwritten by the quick-add' },
        ],
    },
    {
        id: 'quick-add-five-people',
        name: 'Quick-add a five-person team in one message',
        category: 'people-workflow',
        userInput: 'Add my team: Alice the PM, Marco on backend, Priya on data, Sam in QA, and Lena on mobile',
        vaultSeed: [ME_SEED],
        assertions: [
            { type: 'entity_created', entityType: 'person', titleMatch: 'Alice', description: 'Alice should be created' },
            { type: 'entity_created', entityType: 'person', titleMatch: 'Marco', description: 'Marco should be created' },
            { type: 'entity_created', entityType: 'person', titleMatch: 'Priya', description: 'Priya should be created' },
            { type: 'entity_created', entityType: 'person', titleMatch: 'Sam', description: 'Sam should be created' },
            { type: 'entity_created', entityType: 'person', titleMatch: 'Lena', description: 'Lena should be created' },
            { type: 'entity_count', entityType: 'person', expected: 6, description: 'Exactly 6 persons: owner + 5 team members' },
        ],
        timeoutSeconds: 180,
    },
    {
        id: 'refine-lastname-after-quick-add',
        name: 'Refine: add a last name to a just-added person',
        category: 'people-workflow',
        userInput: "Ben's last name is Torres",
        history: QUICK_ADD_HISTORY,
        vaultSeed: SPARSE_PEOPLE_SEED,
        assertions: [
            { type: 'entity_updated', entityType: 'person', titleMatch: 'Ben', description: "Ben's record should be updated with the last name" },
            { type: 'entity_count', entityType: 'person', expected: 4, description: 'No new person — this refines the existing Ben' },
            { type: 'entity_field', entityType: 'person', titleMatch: 'Gary', field: 'name', expected: 'Gary Tester', dimension: 'accuracy', description: 'The ME node must not absorb the refinement' },
        ],
    },
    {
        id: 'refine-details-after-quick-add',
        name: 'Refine: add contact details to a just-added person',
        category: 'people-workflow',
        userInput: 'Kate works at Acme Corp and her email is kate@acme.example',
        history: QUICK_ADD_HISTORY,
        vaultSeed: SPARSE_PEOPLE_SEED,
        assertions: [
            { type: 'entity_updated', entityType: 'person', titleMatch: 'Kate', description: "Kate's record should be updated with employer and email" },
            { type: 'entity_field', entityType: 'person', titleMatch: 'Kate', field: 'email', expected: 'kate@acme.example', description: "Kate's email should land in her email field", dimension: 'completeness' },
            { type: 'entity_count', entityType: 'person', expected: 4, description: 'No new person — this refines the existing Kate' },
        ],
    },
    {
        id: 'refine-picks-right-person',
        name: 'Refine: attribute lands on the named person, not a similar one',
        category: 'people-workflow',
        userInput: "Jeremy's birthday is March 12",
        history: QUICK_ADD_HISTORY,
        vaultSeed: SPARSE_PEOPLE_SEED,
        assertions: [
            { type: 'entity_updated', entityType: 'person', titleMatch: 'Jeremy', description: "Jeremy's record gets the birthday" },
            { type: 'entity_count', entityType: 'person', expected: 4, description: 'No new person created for the birthday note' },
            { type: 'entity_field', entityType: 'person', titleMatch: 'Gary', field: 'name', expected: 'Gary Tester', dimension: 'accuracy', description: 'The ME node must not receive the birthday' },
        ],
    },
];
