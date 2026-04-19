/**
 * Create vs Update Scenarios
 *
 * Tests whether Phaibel correctly updates existing entities vs creating new ones.
 */
import type { EvalScenario } from '../types.js';

export const createVsUpdateScenarios: EvalScenario[] = [
    {
        id: 'update-existing-task',
        name: 'Marking a task done updates it, does not create a new one',
        category: 'create-vs-update',
        userInput: 'Mark buy groceries as done',
        vaultSeed: [
            {
                entityType: 'task',
                title: 'Buy groceries',
                fields: { status: 'open', priority: 'medium' },
            },
        ],
        assertions: [
            {
                type: 'entity_updated',
                entityType: 'task',
                titleMatch: 'groceries',
                description: 'Existing task should be updated',
            },
            {
                type: 'entity_field',
                entityType: 'task',
                titleMatch: 'groceries',
                field: 'status',
                expected: 'complete',
                description: 'Task status should be set to complete',
            },
            {
                type: 'entity_count',
                entityType: 'task',
                expected: 1,
                description: 'Should still have exactly 1 task (no duplicate created)',
            },
        ],
    },
    {
        id: 'create-alongside-existing',
        name: 'Adding a new task alongside an existing one',
        category: 'create-vs-update',
        userInput: 'Add a task to clean the kitchen',
        vaultSeed: [
            {
                entityType: 'task',
                title: 'Buy groceries',
                fields: { status: 'open', priority: 'medium' },
            },
        ],
        assertions: [
            {
                type: 'entity_created',
                entityType: 'task',
                titleMatch: 'kitchen',
                description: 'A new task should be created for cleaning the kitchen',
            },
            {
                type: 'entity_count',
                entityType: 'task',
                expected: 2,
                description: 'Should have 2 tasks total (existing + new)',
            },
        ],
    },
];
