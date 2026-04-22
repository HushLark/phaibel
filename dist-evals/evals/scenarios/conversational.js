export const conversationalScenarios = [
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
