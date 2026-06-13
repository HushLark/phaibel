/**
 * Busy-parent persona.
 *
 * Kids' activities, appointments, school logistics, groceries, the partner.
 * Same coverage shape as the executive suite: entity-type discrimination,
 * create-vs-update, multi-entity, and retrieval-relevance scenarios that
 * exercise the v2 dimension scorer (docs/RELEVANCE-DIMENSIONS.md).
 */
import type { EvalScenario } from '../types.js';

const day = (offset: number): string => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
};

export const familyScenarios: EvalScenario[] = [
    // ── Entity-type discrimination ────────────────────────────────────────
    {
        id: 'family-activity-is-event',
        name: 'A scheduled kid activity is an event, not a task',
        category: 'persona',
        userInput: 'Emma has soccer practice Tuesday at 5pm',
        assertions: [
            { type: 'entity_type_correct', titleMatch: 'soccer', expectedType: 'event', wrongTypes: ['task'],
              description: 'A recurring scheduled activity is an event, not a task' },
        ],
    },
    {
        id: 'family-errand-is-task',
        name: 'An errand with no time is a task',
        category: 'persona',
        userInput: 'I need to pick up groceries for the week',
        assertions: [
            { type: 'entity_type_correct', titleMatch: 'groceries', expectedType: 'task', wrongTypes: ['event'],
              description: 'An untimed errand is a task' },
        ],
    },
    {
        id: 'family-todont',
        name: 'A stop-doing intention creates a todont',
        category: 'persona',
        userInput: 'I really need to stop saying yes to every PTA request',
        assertions: [
            { type: 'entity_created', entityType: 'todont', titleMatch: 'PTA',
              description: 'A todont should capture the thing to stop doing' },
            { type: 'entity_not_created', entityType: 'task', titleMatch: 'PTA',
              description: 'A todont is not a task' },
        ],
    },

    // ── Create vs. update ─────────────────────────────────────────────────
    {
        id: 'family-reschedule-appointment',
        name: 'Rescheduling updates the seeded appointment rather than duplicating it',
        category: 'persona',
        vaultSeed: [
            { entityType: 'event', title: "Emma's dentist appointment", fields: { startDate: `${day(3)}T09:00:00` } },
        ],
        userInput: "Move Emma's dentist appointment to next Friday at 2pm",
        assertions: [
            { type: 'entity_updated', entityType: 'event', titleMatch: 'dentist',
              description: 'The existing appointment should be rescheduled, not duplicated' },
            { type: 'entity_count', entityType: 'event', expected: 1,
              description: 'No duplicate appointment should be created' },
        ],
    },

    // ── Multi-entity ──────────────────────────────────────────────────────
    {
        id: 'family-slip-and-conference',
        name: 'Sign-the-slip reminder plus a scheduled conference in one request',
        category: 'persona',
        userInput: `Remind me to sign Jack's permission slip and schedule the parent-teacher conference for Wednesday at 4pm`,
        assertions: [
            { type: 'entity_created', entityType: 'task', titleMatch: 'permission slip',
              description: 'A task for signing the slip should be created' },
            { type: 'entity_created', entityType: 'event', titleMatch: 'parent-teacher',
              description: 'A scheduled conference should be an event' },
        ],
    },

    // ── Temporal relevance ────────────────────────────────────────────────
    {
        id: 'family-this-week',
        name: "This-week question surfaces near activities, not far ones",
        category: 'persona',
        vaultSeed: [
            { entityType: 'event', title: "Jack's recital", fields: { startDate: `${day(2)}T18:00:00` } },
            { entityType: 'event', title: 'Summer camp drop-off', fields: { startDate: `${day(70)}T08:00:00` } },
        ],
        userInput: 'What do the kids have going on this week?',
        assertions: [
            { type: 'response_contains', match: 'recital',
              description: 'The near-term activity should surface' },
            { type: 'response_not_contains', match: 'camp',
              description: 'An activity 70 days out should not surface for "this week"' },
        ],
    },

    // ── Context proximity (which child the query is about) ────────────────
    {
        id: 'family-emma-coming-up',
        name: "Asking about one child surfaces their items, not the sibling's",
        category: 'persona',
        vaultSeed: [
            { entityType: 'person', title: 'Emma', fields: { type: 'family', role: 'daughter' } },
            { entityType: 'person', title: 'Jack', fields: { type: 'family', role: 'son' } },
            { entityType: 'event', title: 'Soccer practice', fields: { startDate: `${day(1)}T17:00:00` }, body: 'For [[Emma]].' },
            { entityType: 'event', title: 'Piano lesson', fields: { startDate: `${day(1)}T16:00:00` }, body: 'For [[Jack]].' },
        ],
        userInput: "What's coming up for Emma?",
        assertions: [
            { type: 'response_contains', match: 'Soccer',
              description: "Emma's activity should surface (context proximity to Emma)" },
            { type: 'response_not_contains', match: 'Piano',
              description: "Jack's activity should not surface for an Emma-specific question" },
        ],
    },

    // ── Semantic recall (find the right note) ─────────────────────────────
    {
        id: 'family-allergy-recall',
        name: 'Factual recall surfaces the matching note over an unrelated one',
        category: 'persona',
        vaultSeed: [
            { entityType: 'note', title: "Emma's medical info", body: 'Emma is allergic to peanuts. Carries an EpiPen in her backpack.' },
            { entityType: 'note', title: 'Vacation packing list', body: 'Sunscreen, swimsuits, chargers, snacks.' },
        ],
        userInput: "What's Emma allergic to again?",
        assertions: [
            { type: 'response_contains', match: 'peanut',
              description: 'The medical note should be retrieved and cited (semantic match)' },
        ],
    },
];
