/**
 * Persona Scenarios — Dialog & feedback widgets
 *
 * Auto-generated for /innovate. These scenarios test Phaibel's ability
 * to ask clarifying questions via prompt_input/prompt_select when the
 * user's request is missing required information, rather than guessing
 * or failing validation.
 */
import type { EvalScenario } from '../types.js';

export const personaScenarios: EvalScenario[] = [
    {
        id: 'persona-event-missing-time',
        name: 'Event with date but no time should still create event',
        category: 'persona',
        userInput: 'Add an event for my team standup next Monday',
        assertions: [
            {
                type: 'entity_created',
                entityType: 'event',
                titleMatch: 'standup',
                description: 'An event should be created for the standup',
            },
        ],
    },
    {
        id: 'persona-task-with-priority',
        name: 'Task with explicit priority sets the field',
        category: 'persona',
        userInput: 'Add a high priority task to review the Q2 budget',
        assertions: [
            {
                type: 'entity_created',
                entityType: 'task',
                titleMatch: 'budget',
                description: 'A task should be created for the budget review',
            },
            {
                type: 'entity_field',
                entityType: 'task',
                titleMatch: 'budget',
                field: 'priority',
                expected: 'high',
                description: 'Priority should be set to high as explicitly stated',
            },
        ],
    },
    {
        id: 'persona-goal-created-cleanly',
        name: 'Goal creation succeeds without validation errors',
        category: 'persona',
        userInput: 'My goal is to read 24 books this year',
        assertions: [
            {
                type: 'entity_created',
                entityType: 'goal',
                titleMatch: 'book',
                description: 'A goal should be created for reading books',
            },
        ],
    },
    {
        id: 'persona-note-with-info',
        name: 'Note stores reference information correctly',
        category: 'persona',
        userInput: 'Remember that the garage door code is 4821',
        assertions: [
            {
                type: 'entity_created',
                entityType: 'note',
                titleMatch: 'garage',
                description: 'A note should be created for the garage door code',
            },
            {
                type: 'response_contains',
                match: '4821',
                description: 'Response should confirm the code was stored',
            },
        ],
    },
    {
        id: 'persona-contact-partial-info',
        name: 'Contact creation with partial info succeeds',
        category: 'persona',
        userInput: 'Add a contact for my plumber Mike, phone 555-0199',
        assertions: [
            {
                type: 'entity_created',
                entityType: 'person',
                titleMatch: 'Mike',
                description: 'A person entity should be created for Mike',
            },
            {
                type: 'entity_field',
                entityType: 'person',
                titleMatch: 'Mike',
                field: 'phone',
                expected: '555-0199',
                description: 'Phone field should be populated',
            },
        ],
    },
    {
        id: 'persona-todont-simple',
        name: 'Simple stop-doing creates todont without errors',
        category: 'persona',
        userInput: 'I should stop eating fast food for lunch',
        assertions: [
            {
                type: 'entity_created',
                entityType: 'todont',
                titleMatch: 'fast food',
                description: 'A todont should be created',
            },
            {
                type: 'entity_not_created',
                entityType: 'task',
                titleMatch: 'fast food',
                description: 'Should not create a task for a stop-doing',
            },
        ],
    },
];
