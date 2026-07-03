/**
 * Conversational Scenarios
 *
 * Tests person creation and model awareness.
 */
import type { EvalScenario } from '../types.js';

export const conversationalScenarios: EvalScenario[] = [
    {
        id: 'faithful-recall',
        name: 'Answer about stored facts contains no fabricated details',
        category: 'conversational',
        timeoutSeconds: 120,
        userInput: "When is my mom's birthday and what did she ask for?",
        vaultSeed: [
            {
                entityType: 'note',
                title: "Mom's birthday",
                body: 'Mom\'s birthday is March 12. She asked for a rosemary plant and a photo book.',
            },
        ],
        assertions: [
            {
                type: 'response_contains',
                match: 'March 12',
                description: 'The stored birthday date should be surfaced',
            },
            {
                type: 'response_faithful',
                description: 'Every claim in the answer must be supported by the vault (no invented gifts, dates, or details)',
            },
        ],
    },
    {
        id: 'person-creation',
        name: 'Adding a contact creates a person entity with fields',
        category: 'conversational',
        timeoutSeconds: 120,
        userInput: 'Add a contact: Sarah Chen, works at Acme Corp, email sarah@acme.com',
        assertions: [
            {
                type: 'entity_created',
                entityType: 'person',
                titleMatch: 'Sarah',
                description: 'A person entity should be created for Sarah',
            },
            {
                type: 'entity_field',
                entityType: 'person',
                titleMatch: 'Sarah',
                field: 'email',
                expected: 'sarah@acme.com',
                description: 'Email field should be set correctly',
            },
            {
                type: 'entity_field',
                entityType: 'person',
                titleMatch: 'Sarah',
                field: 'company',
                expected: 'Acme',
                description: 'Company field should contain Acme',
            },
        ],
    },
    {
        id: 'model-awareness',
        name: 'Phaibel can identify the model it is using',
        category: 'conversational',
        userInput: 'What model are you using right now?',
        assertions: [
            {
                type: 'response_contains',
                match: 'claude',
                description: 'Response should mention the model name (claude)',
                weight: 0.5,
            },
        ],
        timeoutSeconds: 60,
    },
];
