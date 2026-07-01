/**
 * CxMS Mutation Scenarios
 *
 * Direct coverage for the core CxMS write operations that regressed:
 *   - update nodes (rename / set field) — must actually persist AND preserve body
 *   - add nodes
 *   - add context types
 *   - move nodes between context types (person → subtype)
 *
 * These are deliberately strict: they assert the vault actually changed (not just
 * that the response *claims* success), that no duplicate was created, and that the
 * body survives an update/move (the "body → null" regression).
 */
import type { EvalScenario } from '../types.js';

export const cxmsMutationScenarios: EvalScenario[] = [
    // ── UPDATE: rename must persist and NOT wipe the body ────────────────────────
    {
        id: 'cxms-rename-preserves-body',
        name: 'Renaming a person persists the new name and preserves the body',
        category: 'cxms-mutation',
        userInput: 'Rename Denete to Denette',
        vaultSeed: [
            {
                entityType: 'person',
                title: 'Denete',
                fields: { type: 'family' },
                body: 'Wife of Herbie.',
            },
        ],
        assertions: [
            {
                type: 'entity_type_correct',
                titleMatch: 'Denette',
                expectedType: 'person',
                description: 'A person named "Denette" should exist after the rename (it actually persisted)',
            },
            {
                type: 'entity_body',
                entityType: 'person',
                titleMatch: 'Denette',
                match: 'Wife of Herbie',
                description: 'Body must be preserved through the rename (regression: body → "null")',
            },
            {
                type: 'entity_count',
                entityType: 'person',
                expected: 1,
                description: 'Rename must not create a duplicate person',
            },
            {
                type: 'response_not_contains',
                match: 'null',
                description: 'Response should not surface a null body',
            },
        ],
    },

    // ── UPDATE: set a field on an existing node ──────────────────────────────────
    {
        id: 'cxms-set-field',
        name: 'Setting a field updates the existing node in place',
        category: 'cxms-mutation',
        userInput: "Set Sam Rivera's phone to +1 555 0142",
        vaultSeed: [
            { entityType: 'person', title: 'Sam Rivera', fields: { type: 'colleague' } },
        ],
        assertions: [
            {
                type: 'entity_field',
                entityType: 'person',
                titleMatch: 'Sam Rivera',
                field: 'phone',
                expected: '+1 555 0142',
                description: 'Phone field should be set on the existing person',
            },
            {
                type: 'entity_count',
                entityType: 'person',
                expected: 1,
                description: 'Setting a field must not create a duplicate',
            },
        ],
    },

    // ── ADD: create a new node with a field ──────────────────────────────────────
    {
        id: 'cxms-add-node',
        name: 'Adding a new person creates it with the given field',
        category: 'cxms-mutation',
        userInput: 'Add my colleague Priya Nadella — her email is priya@acme.com',
        assertions: [
            {
                type: 'entity_created',
                entityType: 'person',
                titleMatch: 'Priya',
                description: 'A new person "Priya Nadella" should be created',
            },
            {
                type: 'entity_field',
                entityType: 'person',
                titleMatch: 'Priya',
                field: 'email',
                expected: 'priya@acme.com',
                description: 'The email field should be captured on create',
            },
        ],
    },

    // ── ADD CONTEXT TYPE ─────────────────────────────────────────────────────────
    {
        id: 'cxms-add-context-type',
        name: 'Creating a new context type registers it',
        category: 'cxms-mutation',
        userInput: 'I want to track my vehicles. Create a "vehicle" context type with fields for make, model, and year.',
        assertions: [
            {
                type: 'context_type_created',
                typeName: 'vehicle',
                description: 'A "vehicle" context type should be registered',
            },
        ],
        timeoutSeconds: 90,
    },

    // ── MOVE between context types (the core regression) ─────────────────────────
    {
        id: 'cxms-move-node-to-subtype',
        name: 'Moving a person to a subtype reclassifies it, preserves body, no duplicate',
        category: 'cxms-mutation',
        userInput: 'Move Denette into the immediate_family context type',
        vaultSeed: [
            {
                entityType: 'person',
                title: 'Denette',
                fields: { type: 'family' },
                body: 'Wife of Herbie.',
            },
        ],
        assertions: [
            {
                type: 'entity_type_correct',
                titleMatch: 'Denette',
                expectedType: 'immediate_family',
                wrongTypes: ['person'],
                description: 'Denette should now be an immediate_family node, no longer a person',
            },
            {
                type: 'entity_body',
                entityType: 'immediate_family',
                titleMatch: 'Denette',
                match: 'Wife of Herbie',
                description: 'Body must survive the move to the new context type',
            },
            {
                type: 'entity_count',
                entityType: 'person',
                expected: 0,
                description: 'The source person type should no longer contain Denette (moved, not copied)',
            },
        ],
        timeoutSeconds: 90,
    },
];
