/**
 * Executive persona — busy VP / CEO.
 *
 * Renewals, board prep, 1:1s, multi-year deals, protected focus time. Covers
 * entity-type discrimination, create-vs-update, multi-entity, and — the focus
 * of this suite — retrieval relevance, which exercises the v2 dimension scorer
 * (see docs/RELEVANCE-DIMENSIONS.md). Relevance scenarios assert that the answer
 * surfaces the RIGHT entity and omits the distractor, via response_contains +
 * response_not_contains over distractor-seeded vaults.
 */
import type { EvalScenario } from '../types.js';

/** YYYY-MM-DD offset from today, for stable relative dates. */
const day = (offset: number): string => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
};

export const execScenarios: EvalScenario[] = [
    // ── Entity-type discrimination ────────────────────────────────────────
    {
        id: 'exec-focus-block-is-event',
        name: 'Blocking calendar time creates an event, not a task',
        category: 'persona',
        userInput: 'Block two hours Thursday morning for board deck prep',
        assertions: [
            { type: 'entity_type_correct', titleMatch: 'board deck', expectedType: 'event', wrongTypes: ['task'],
              description: 'A time-blocked focus session is an event, not a task' },
        ],
    },
    {
        id: 'exec-review-is-task',
        name: 'An action item with no time is a task, not an event',
        category: 'persona',
        userInput: 'Remind me to review the Q3 revenue forecast before the board call',
        assertions: [
            { type: 'entity_type_correct', titleMatch: 'forecast', expectedType: 'task', wrongTypes: ['event'],
              description: 'A review reminder with no scheduled time is a task' },
        ],
    },

    // ── Create vs. update ─────────────────────────────────────────────────
    {
        id: 'exec-complete-existing-task',
        name: 'Completing a seeded task updates it rather than creating a new one',
        category: 'persona',
        vaultSeed: [
            { entityType: 'task', title: 'Review Acme renewal contract', fields: { status: 'open', priority: 'high', dueDate: day(1) } },
        ],
        userInput: 'I finished reviewing the Acme renewal contract',
        assertions: [
            { type: 'entity_updated', entityType: 'task', titleMatch: 'Acme renewal',
              description: 'The existing Acme contract task should be updated to done' },
            { type: 'entity_field', entityType: 'task', titleMatch: 'Acme renewal', field: 'status', expected: 'done',
              description: 'Status should be set to done' },
            { type: 'entity_count', entityType: 'task', expected: 1,
              description: 'No duplicate task should be created' },
        ],
    },

    // ── Multi-entity ──────────────────────────────────────────────────────
    {
        id: 'exec-schedule-and-prep',
        name: 'Schedule a 1:1 and add a prep task in one request',
        category: 'persona',
        userInput: `Set up a 1:1 with Dana this Friday at 3pm and add a task to prep the renewal talking points`,
        assertions: [
            { type: 'entity_created', entityType: 'event', titleMatch: 'Dana',
              description: 'A 1:1 event with Dana should be created' },
            { type: 'entity_created', entityType: 'task', titleMatch: 'talking points',
              description: 'A prep task should be created' },
        ],
    },

    // ── Temporal relevance (salience curve) ───────────────────────────────
    {
        id: 'exec-whats-this-week',
        name: 'Near-term events surface; far-future ones do not',
        category: 'persona',
        vaultSeed: [
            { entityType: 'event', title: 'Acme renewal call', fields: { startDate: `${day(2)}T11:30:00` } },
            { entityType: 'event', title: 'Annual sales kickoff', fields: { startDate: `${day(85)}T09:00:00` } },
            { entityType: 'event', title: 'Q2 retro', fields: { startDate: `${day(-25)}T15:00:00` } },
        ],
        userInput: 'What do I have on my plate this week?',
        assertions: [
            { type: 'response_contains', match: 'Acme renewal call',
              description: 'The near-term event should surface (temporal salience peak)' },
            { type: 'response_not_contains', match: 'sales kickoff',
              description: 'An event 85 days out should not surface for a "this week" query' },
        ],
    },

    // ── Context proximity (graph link to the queried subject) ─────────────
    {
        id: 'exec-acme-status',
        name: 'Asking about a deal surfaces deal-linked items, not another account',
        category: 'persona',
        vaultSeed: [
            { entityType: 'company', title: 'Acme Corp', fields: { industry: 'SaaS' }, body: 'Multi-year renewal in progress.' },
            { entityType: 'company', title: 'Northwind', fields: { industry: 'Retail' }, body: 'Early prospect.' },
            { entityType: 'task', title: 'Send Acme the multi-year quote', fields: { status: 'open', priority: 'high' }, body: 'For [[Acme Corp]] renewal.' },
            { entityType: 'task', title: 'Cold intro to Northwind', fields: { status: 'open', priority: 'low' }, body: 'Prospecting [[Northwind]].' },
        ],
        userInput: 'Where do things stand with the Acme renewal?',
        assertions: [
            { type: 'response_contains', match: 'multi-year quote',
              description: 'The Acme-linked task should surface (context proximity + semantic)' },
            { type: 'response_not_contains', match: 'Northwind',
              description: 'An unrelated account should not bleed into an Acme-specific answer' },
        ],
    },

    // ── Goal alignment ────────────────────────────────────────────────────
    {
        id: 'exec-what-to-focus-on',
        name: 'Focus question surfaces goal-aligned work over busywork',
        category: 'persona',
        vaultSeed: [
            { entityType: 'goal', title: 'Close Q3 enterprise pipeline', fields: { status: 'active', priority: 'high' } },
            { entityType: 'task', title: 'Finalize the enterprise pricing proposal', fields: { status: 'open', priority: 'high' }, body: 'Drives [[Close Q3 enterprise pipeline]].' },
            { entityType: 'task', title: 'Reorder office snacks', fields: { status: 'open', priority: 'low' } },
        ],
        userInput: 'What should I focus on today?',
        assertions: [
            { type: 'response_contains', match: 'pricing proposal',
              description: 'The goal-aligned task should be prioritized' },
            { type: 'response_not_contains', match: 'snacks',
              description: 'Low-value busywork should not lead a focus answer' },
        ],
    },
];
