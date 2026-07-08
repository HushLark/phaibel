/**
 * Business ↔ Place Relationship Scenarios
 *
 * Businesses relate to places in several distinct ways, and each should
 * produce real graph edges — not just prose in a note body:
 *   - a chain with multiple nearby locations   (Chipotle → 2 local spots)
 *   - a company with a headquarters            (United Airlines → Chicago)
 *   - a company serving many places            (United → the airports it flies to)
 *   - retrieval back across those edges        ("which locations are near us?")
 *
 * Location entities may reasonably land as `place` or its `spot` subtype, so
 * the entity_linked assertions deliberately omit type restrictions on the
 * place end and search the whole snapshot by title.
 */
import type { EvalScenario } from '../types.js';

export const businessPlaceRelationshipScenarios: EvalScenario[] = [
    {
        id: 'biz-multi-location',
        name: 'A chain business with two nearby locations',
        category: 'business-workflow',
        userInput: 'Remember Chipotle — we eat there a lot. They have two locations near us: one on Main Street and one at the Riverside Mall.',
        assertions: [
            { type: 'entity_created', entityType: 'company', titleMatch: 'Chipotle', description: 'Chipotle should be created as a business (company)' },
            { type: 'entity_linked', sourceTitleMatch: 'Chipotle', targetTitleMatch: 'Main', description: 'Chipotle should be linked to the Main Street location' },
            { type: 'entity_linked', sourceTitleMatch: 'Chipotle', targetTitleMatch: 'Riverside', description: 'Chipotle should be linked to the Riverside Mall location' },
        ],
        timeoutSeconds: 180,
    },
    {
        id: 'biz-headquarters',
        name: 'A company headquartered in a city',
        category: 'business-workflow',
        userInput: 'United Airlines is headquartered in Chicago.',
        assertions: [
            { type: 'entity_created', entityType: 'company', titleMatch: 'United', description: 'United Airlines should be created as a business (company)' },
            { type: 'entity_linked', sourceTitleMatch: 'United', targetTitleMatch: 'Chicago', description: 'United should be linked to Chicago (its headquarters)' },
        ],
    },
    {
        id: 'biz-serves-airports',
        name: 'An existing company linked to the places it serves',
        category: 'business-workflow',
        vaultSeed: [
            {
                entityType: 'company',
                title: 'United Airlines',
                fields: { industry: 'Aviation' },
                body: 'Airline we fly with for work trips.',
            },
        ],
        userInput: 'United Airlines flies into Denver International, SFO, and O\'Hare for the routes we use.',
        assertions: [
            { type: 'entity_linked', sourceTitleMatch: 'United', targetTitleMatch: 'Denver', description: 'United should be linked to Denver International' },
            { type: 'entity_linked', sourceTitleMatch: 'United', targetTitleMatch: 'SFO|San Francisco', description: 'United should be linked to SFO (or its expanded name)' },
            { type: 'entity_linked', sourceTitleMatch: 'United', targetTitleMatch: "O'Hare", description: "United should be linked to O'Hare" },
            { type: 'entity_count', entityType: 'company', expected: 1, description: 'The existing United Airlines company is reused — no duplicate created' },
        ],
        timeoutSeconds: 180,
    },
    {
        id: 'biz-location-retrieval',
        name: 'Retrieve a business\'s locations across its place links',
        category: 'business-workflow',
        vaultSeed: [
            {
                entityType: 'company',
                title: 'Chipotle',
                fields: {
                    id: 'CMPCHIP1',
                    links: [
                        { target: 'spot:SPTMAIN1', label: 'location' },
                        { target: 'spot:SPTMALL1', label: 'location' },
                    ],
                },
                body: 'Burrito chain we eat at weekly.',
            },
            {
                entityType: 'spot',
                title: 'Chipotle Main Street',
                fields: { id: 'SPTMAIN1', address: '4th & Main St', category: 'restaurant' },
                body: 'The Chipotle on Main Street, close to the office.',
            },
            {
                entityType: 'spot',
                title: 'Chipotle Riverside Mall',
                fields: { id: 'SPTMALL1', address: 'Riverside Mall food court', category: 'restaurant' },
                body: 'The Chipotle in the Riverside Mall food court.',
            },
            // Distractor: an unrelated spot that should not surface as a Chipotle location
            {
                entityType: 'spot',
                title: 'Big Sky Trailhead',
                fields: { id: 'SPTTRAIL', category: 'outdoors' },
                body: 'Weekend hiking trailhead.',
            },
        ],
        userInput: 'Which Chipotle locations are near us?',
        assertions: [
            { type: 'response_contains', match: 'Main', description: 'The answer should mention the Main Street location' },
            { type: 'response_contains', match: 'Riverside', description: 'The answer should mention the Riverside Mall location' },
            { type: 'response_not_contains', match: 'Trailhead', description: 'The unrelated trailhead should not surface as a Chipotle location' },
            { type: 'response_faithful', description: 'Claims about locations should be grounded in the vault' },
        ],
    },
];
