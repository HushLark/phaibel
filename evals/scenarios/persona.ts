/**
 * Persona Scenarios — Parent of a college student
 *
 * Auto-generated for /innovate. These scenarios test Phaibel's ability
 * to handle use cases specific to: a parent managing tasks, events, goals,
 * and contacts related to their college-aged child.
 */
import type { EvalScenario } from '../types.js';

export const personaScenarios: EvalScenario[] = [
    {
        id: 'persona-orientation-event',
        name: 'College orientation is an event, not a task',
        category: 'persona',
        userInput: 'My daughter has freshman orientation on August 20th at 9am',
        assertions: [
            {
                type: 'entity_created',
                entityType: 'event',
                titleMatch: 'orientation',
                description: 'An event should be created for orientation',
            },
            {
                type: 'entity_not_created',
                entityType: 'task',
                titleMatch: 'orientation',
                description: 'Orientation is a scheduled event, not a task',
            },
        ],
    },
    {
        id: 'persona-tuition-task',
        name: 'Paying tuition is a task, not an event',
        category: 'persona',
        userInput: 'I need to pay the spring semester tuition before January 15th',
        assertions: [
            {
                type: 'entity_created',
                entityType: 'task',
                titleMatch: 'tuition',
                description: 'A task should be created for paying tuition',
            },
            {
                type: 'entity_not_created',
                entityType: 'event',
                titleMatch: 'tuition',
                description: 'Paying tuition is an action item, not a calendar event',
            },
        ],
    },
    {
        id: 'persona-roommate-contact',
        name: 'Adding roommate as a contact creates a person',
        category: 'persona',
        userInput: "Add my son's roommate: Jake Torres, phone 555-0147, email jake.torres@university.edu",
        assertions: [
            {
                type: 'entity_created',
                entityType: 'person',
                titleMatch: 'Jake',
                description: 'A person entity should be created for the roommate',
            },
            {
                type: 'entity_field',
                entityType: 'person',
                titleMatch: 'Jake',
                field: 'email',
                expected: 'jake.torres@university.edu',
                description: 'Email field should be populated',
            },
        ],
    },
    {
        id: 'persona-graduation-goal',
        name: 'Graduation goal is a goal, not a task',
        category: 'persona',
        userInput: 'My goal is to help my daughter graduate debt-free',
        assertions: [
            {
                type: 'entity_created',
                entityType: 'goal',
                titleMatch: 'debt-free',
                description: 'A goal should be created for the long-term objective',
            },
            {
                type: 'entity_not_created',
                entityType: 'task',
                titleMatch: 'debt-free',
                description: 'A long-term aspiration should be a goal, not a task',
            },
        ],
    },
    {
        id: 'persona-move-in-multi',
        name: 'Move-in day creates event + task in one request',
        category: 'persona',
        userInput: 'Move-in day is September 1st at noon, and I need to rent a moving truck before then',
        assertions: [
            {
                type: 'entity_created',
                entityType: 'event',
                titleMatch: 'move',
                description: 'An event should be created for move-in day',
            },
            {
                type: 'entity_created',
                entityType: 'task',
                titleMatch: 'truck',
                description: 'A task should be created for renting the truck',
            },
        ],
    },
    {
        id: 'persona-update-tuition-done',
        name: 'Mark existing tuition task as complete',
        category: 'persona',
        vaultSeed: [
            { entityType: 'task', title: 'Pay spring tuition', fields: { status: 'open', priority: 'high' } },
        ],
        userInput: 'I paid the spring tuition, mark it done',
        assertions: [
            {
                type: 'entity_updated',
                entityType: 'task',
                titleMatch: 'tuition',
                description: 'The existing tuition task should be updated, not a new one created',
            },
            {
                type: 'entity_count',
                entityType: 'task',
                expected: 1,
                description: 'Should still have only 1 task (updated, not duplicated)',
            },
        ],
    },
    {
        id: 'persona-care-package-note',
        name: 'Care package ideas stored as a note',
        category: 'persona',
        userInput: "Remember that Emma likes dark chocolate, trail mix, and fuzzy socks for care packages",
        assertions: [
            {
                type: 'entity_created',
                entityType: 'note',
                titleMatch: 'care package',
                description: 'A note should be created to remember care package preferences',
            },
            {
                type: 'entity_not_created',
                entityType: 'task',
                titleMatch: 'care package',
                description: 'Remembering preferences is a note, not a task',
            },
        ],
    },
    {
        id: 'persona-stop-helicopter',
        name: 'Stop-doing statement creates a todont',
        category: 'persona',
        userInput: 'I need to stop calling the registrar on behalf of my son — he should handle it himself',
        assertions: [
            {
                type: 'entity_created',
                entityType: 'todont',
                titleMatch: 'registrar',
                description: 'A todont should be created for the habit to stop',
            },
            {
                type: 'entity_not_created',
                entityType: 'task',
                titleMatch: 'registrar',
                description: 'A stop-doing statement should not create a task',
            },
        ],
    },
];
