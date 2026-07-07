/**
 * Business Workflow Scenarios
 *
 * Exercises the 'business' life primitive and its customer/vendor subtypes:
 * organizations should be created as the right type (not filed as places or
 * generic notes), and customer/vendor should resolve to their subtypes.
 */
import type { EvalScenario } from '../types.js';

export const businessWorkflowScenarios: EvalScenario[] = [
    {
        id: 'create-company',
        name: 'Remembering a company creates a company (not a place/note)',
        category: 'people-workflow',
        userInput: 'Remember the company Acme Corp — they make industrial widgets',
        assertions: [
            { type: 'entity_created', entityType: 'company', titleMatch: 'Acme', description: 'A company should be created for Acme Corp' },
            { type: 'entity_type_correct', titleMatch: 'Acme', expectedType: 'company', wrongTypes: ['place', 'note'], description: 'Acme Corp should be a company, not a place or note' },
        ],
    },
    {
        id: 'create-customer',
        name: 'A business we sell to is a customer',
        category: 'people-workflow',
        userInput: 'Add Globex as a customer — an active account we sell to',
        assertions: [
            { type: 'entity_created', entityType: 'customer', titleMatch: 'Globex', description: 'A customer should be created for Globex' },
            { type: 'entity_type_correct', titleMatch: 'Globex', expectedType: 'customer', wrongTypes: ['company', 'person'], description: 'Globex should be typed as a customer' },
        ],
    },
    {
        id: 'create-vendor',
        name: 'A business we buy from is a vendor',
        category: 'people-workflow',
        userInput: 'Remember Initech as a vendor — they supply our office equipment',
        assertions: [
            { type: 'entity_created', entityType: 'vendor', titleMatch: 'Initech', description: 'A vendor should be created for Initech' },
            { type: 'entity_type_correct', titleMatch: 'Initech', expectedType: 'vendor', wrongTypes: ['company', 'person'], description: 'Initech should be typed as a vendor' },
        ],
    },
];
