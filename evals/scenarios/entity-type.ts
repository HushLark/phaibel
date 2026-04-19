/**
 * Entity Type Selection Scenarios
 *
 * Tests whether Phaibel picks the correct entity type for different inputs.
 */
import type { EvalScenario } from '../types.js';

export const entityTypeScenarios: EvalScenario[] = [
    {
        id: 'event-not-task',
        name: 'Dentist appointment creates event, not task',
        category: 'entity-type',
        userInput: 'I have a dentist appointment next Tuesday at 2pm',
        assertions: [
            {
                type: 'entity_created',
                entityType: 'event',
                titleMatch: 'dentist',
                description: 'An event should be created for the appointment',
            },
            {
                type: 'entity_not_created',
                entityType: 'task',
                titleMatch: 'dentist',
                description: 'A task should NOT be created for an appointment',
            },
        ],
    },
    {
        id: 'task-not-event',
        name: 'Buying groceries creates task, not event',
        category: 'entity-type',
        userInput: 'I need to buy groceries this weekend',
        assertions: [
            {
                type: 'entity_created',
                entityType: 'task',
                titleMatch: 'grocer',
                description: 'A task should be created for buying groceries',
            },
            {
                type: 'entity_not_created',
                entityType: 'event',
                titleMatch: 'grocer',
                description: 'An event should NOT be created for a chore',
            },
        ],
    },
    {
        id: 'goal-not-task',
        name: 'Marathon goal creates goal, not task',
        category: 'entity-type',
        userInput: 'My goal for this year is to run a marathon',
        assertions: [
            {
                type: 'entity_created',
                entityType: 'goal',
                titleMatch: 'marathon',
                description: 'A goal should be created for a long-term objective',
            },
            {
                type: 'entity_not_created',
                entityType: 'task',
                titleMatch: 'marathon',
                description: 'A task should NOT be created for a yearly goal',
            },
        ],
    },
    {
        id: 'note-not-task',
        name: 'Wifi password creates note, not task',
        category: 'entity-type',
        userInput: 'Remember that the wifi password is sunflower42',
        assertions: [
            {
                type: 'entity_created',
                entityType: 'note',
                titleMatch: 'wifi',
                description: 'A note should be created for a piece of info to remember',
            },
            {
                type: 'entity_not_created',
                entityType: 'task',
                titleMatch: 'wifi',
                description: 'A task should NOT be created for remembering info',
            },
        ],
    },
];
