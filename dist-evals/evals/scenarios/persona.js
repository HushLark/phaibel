export const personaScenarios = [
    // ── Skill: daily briefing ───────────────────────────────────────
    {
        id: 'persona-skill-daily-briefing',
        name: 'Daily briefing skill returns task and event summary',
        category: 'persona',
        vaultSeed: [
            { entityType: 'task', title: 'Review budget', fields: { status: 'open', priority: 'high' } },
            { entityType: 'task', title: 'Call client', fields: { status: 'open', priority: 'medium' } },
            { entityType: 'event', title: 'Team standup', fields: { startDate: '2026-04-21T09:00:00-06:00' } },
        ],
        userInput: 'Give me my morning briefing',
        assertions: [
            {
                type: 'response_contains',
                match: 'budget',
                description: 'Briefing should mention the high-priority budget task',
            },
            {
                type: 'response_contains',
                match: 'standup',
                description: 'Briefing should mention the standup event',
            },
        ],
        timeoutSeconds: 90,
    },
    // ── Custom process: task with priority field ────────────────────
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
    // ── Custom process: multi-entity project kickoff ────────────────
    {
        id: 'persona-project-kickoff-multi',
        name: 'Project kickoff creates event + goal + task',
        category: 'persona',
        userInput: 'Kick off the website redesign project: add a kickoff meeting for next Monday, set a goal to launch by June, and add a task to send the brief to the team.',
        assertions: [
            {
                type: 'entity_created',
                entityType: 'event',
                titleMatch: 'kickoff',
                description: 'A kickoff meeting event should be created',
            },
            {
                type: 'entity_created',
                entityType: 'goal',
                titleMatch: 'website',
                description: 'A website redesign goal should be created',
            },
            {
                type: 'entity_created',
                entityType: 'task',
                titleMatch: 'brief',
                description: 'A task to send the brief should be created',
            },
        ],
        timeoutSeconds: 90,
    },
    // ── Create-vs-update: mark task done ───────────────────────────
    {
        id: 'persona-update-task-status',
        name: 'Mark an existing task done (update, not create)',
        category: 'persona',
        vaultSeed: [
            { entityType: 'task', title: 'Send quarterly report', fields: { status: 'open', priority: 'high' } },
        ],
        userInput: 'I finished sending the quarterly report, mark it done',
        assertions: [
            {
                type: 'entity_updated',
                entityType: 'task',
                titleMatch: 'quarterly report',
                description: 'The existing task should be updated to done',
            },
            {
                type: 'entity_not_created',
                entityType: 'task',
                titleMatch: 'quarterly report',
                description: 'Should not create a duplicate task',
            },
        ],
    },
    // ── Entity type discrimination: note not task ───────────────────
    {
        id: 'persona-note-not-task',
        name: 'Meeting notes create a note, not a task',
        category: 'persona',
        userInput: 'Take a note: discussed migration timeline with engineering, target is end of May',
        assertions: [
            {
                type: 'entity_created',
                entityType: 'note',
                titleMatch: 'migration',
                description: 'A note should be created for meeting notes',
            },
            {
                type: 'entity_not_created',
                entityType: 'task',
                titleMatch: 'migration',
                description: 'Should not create a task for a note',
            },
        ],
    },
    // ── Custom process: person with fields ─────────────────────────
    {
        id: 'persona-add-client-contact',
        name: 'Add a client contact with role and email',
        category: 'persona',
        userInput: 'Add a new contact: Marcus Williams, VP of Engineering at CloudBase, email marcus@cloudbase.io',
        assertions: [
            {
                type: 'entity_created',
                entityType: 'person',
                titleMatch: 'Marcus',
                description: 'A person entity should be created for Marcus',
            },
            {
                type: 'entity_field',
                entityType: 'person',
                titleMatch: 'Marcus',
                field: 'email',
                expected: 'marcus@cloudbase.io',
                description: 'Email should be set correctly',
            },
        ],
    },
    // ── Custom process: todont ──────────────────────────────────────
    {
        id: 'persona-todont-simple',
        name: 'Stop-doing creates todont without errors',
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
    // ── Goal creation ───────────────────────────────────────────────
    {
        id: 'persona-goal-created-cleanly',
        name: 'Goal creation succeeds cleanly',
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
];
