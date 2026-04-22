export const multiEntityScenarios = [
    {
        id: 'two-creates',
        name: 'Create both a task and a goal in one request',
        category: 'multi-entity',
        userInput: 'Add a task to fix the fence and a goal to improve the backyard',
        assertions: [
            {
                type: 'entity_created',
                entityType: 'task',
                titleMatch: 'fence',
                description: 'A task should be created for fixing the fence',
            },
            {
                type: 'entity_created',
                entityType: 'goal',
                titleMatch: 'backyard',
                description: 'A goal should be created for improving the backyard',
            },
        ],
    },
    {
        id: 'todont-creation',
        name: 'Stop-doing statement creates a todont',
        category: 'multi-entity',
        userInput: 'I should stop checking my phone before bed',
        assertions: [
            {
                type: 'entity_created',
                entityType: 'todont',
                titleMatch: 'phone',
                description: 'A todont should be created for the habit to stop',
            },
            {
                type: 'entity_not_created',
                entityType: 'task',
                titleMatch: 'phone',
                description: 'A task should NOT be created for a todont',
            },
        ],
    },
];
