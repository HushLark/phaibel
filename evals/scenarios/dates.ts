/**
 * Date & Datetime Scenarios
 *
 * Exercises relative- and absolute-date resolution when creating tasks and
 * events. Every scenario pins the clock via `referenceDate` so "tomorrow",
 * "next Tuesday at 2pm", "this Friday", "in two weeks" resolve to fixed
 * calendar dates the assertions can check — the suite is reproducible on any
 * day it runs.
 *
 * Reference clock: Sunday, 2026-03-15, 10:00 local. Derived targets:
 *   tomorrow      → 2026-03-16 (Mon)
 *   next Tuesday  → 2026-03-17
 *   Thursday      → 2026-03-19
 *   this Friday   → 2026-03-20
 *   the 20th      → 2026-03-20
 *   in two weeks  → 2026-03-29
 *
 * Date fields (task.dueDate) are plain YYYY-MM-DD. Datetime fields
 * (event.startDate) are ISO with a timezone offset, so assertions match the
 * date+time PREFIX ("2026-03-17T14:00") and ignore the machine's tz offset.
 */
import type { EvalScenario } from '../types.js';

const REF = '2026-03-15T10:00:00';

export const dateScenarios: EvalScenario[] = [
    {
        id: 'date-task-tomorrow',
        name: 'Task due "tomorrow" resolves to the next day',
        category: 'dates',
        referenceDate: REF,
        userInput: 'Add a task to submit the expense report tomorrow',
        assertions: [
            { type: 'entity_created', entityType: 'task', titleMatch: 'expense', description: 'A task should be created' },
            { type: 'entity_field', entityType: 'task', titleMatch: 'expense', field: 'dueDate', expected: '2026-03-16', description: '"tomorrow" from Sun 3/15 → 2026-03-16' },
        ],
    },
    {
        id: 'date-task-this-friday',
        name: 'Task due "this Friday" resolves to the coming Friday',
        category: 'dates',
        referenceDate: REF,
        userInput: 'Remind me to call the bank this Friday',
        assertions: [
            { type: 'entity_created', entityType: 'task', titleMatch: 'bank', description: 'A task should be created' },
            { type: 'entity_field', entityType: 'task', titleMatch: 'bank', field: 'dueDate', expected: '2026-03-20', description: '"this Friday" → 2026-03-20' },
        ],
    },
    {
        id: 'date-task-in-two-weeks',
        name: 'Task due "in two weeks" resolves by date arithmetic',
        category: 'dates',
        referenceDate: REF,
        userInput: 'Add a task to renew the insurance in two weeks',
        assertions: [
            { type: 'entity_created', entityType: 'task', titleMatch: 'insurance', description: 'A task should be created' },
            { type: 'entity_field', entityType: 'task', titleMatch: 'insurance', field: 'dueDate', expected: '2026-03-29', description: '"in two weeks" from 3/15 → 2026-03-29' },
        ],
    },
    {
        id: 'datetime-event-next-tuesday-2pm',
        name: 'Event "next Tuesday at 2pm" resolves date AND time',
        category: 'dates',
        referenceDate: REF,
        userInput: 'Schedule a dentist appointment next Tuesday at 2pm',
        assertions: [
            { type: 'entity_created', entityType: 'event', titleMatch: 'dentist', description: 'An event should be created' },
            { type: 'entity_type_correct', titleMatch: 'dentist', expectedType: 'event', wrongTypes: ['task'], description: 'An appointment is an event, not a task' },
            { type: 'entity_field', entityType: 'event', titleMatch: 'dentist', field: 'startDate', expected: '2026-03-17T14:00', description: 'next Tuesday 2pm → 2026-03-17T14:00' },
        ],
    },
    {
        id: 'datetime-event-absolute-date-noon',
        name: 'Event on an absolute date at noon',
        category: 'dates',
        referenceDate: REF,
        userInput: 'Set up lunch with Sarah on March 20th at noon',
        assertions: [
            { type: 'entity_created', entityType: 'event', titleMatch: 'lunch', description: 'An event should be created' },
            { type: 'entity_field', entityType: 'event', titleMatch: 'lunch', field: 'startDate', expected: '2026-03-20T12:00', description: 'March 20th noon → 2026-03-20T12:00' },
        ],
    },
    {
        id: 'datetime-event-range-duration',
        name: 'Event "Thursday 3 to 4pm" sets start time and duration',
        category: 'dates',
        referenceDate: REF,
        userInput: 'Book a team meeting Thursday from 3 to 4pm',
        assertions: [
            { type: 'entity_created', entityType: 'event', titleMatch: 'team meeting', description: 'An event should be created' },
            { type: 'entity_field', entityType: 'event', titleMatch: 'team meeting', field: 'startDate', expected: '2026-03-19T15:00', description: 'Thursday 3pm → 2026-03-19T15:00' },
            { type: 'entity_field', entityType: 'event', titleMatch: 'team meeting', field: 'duration', expected: '1h', description: '3–4pm is a 1-hour duration', dimension: 'completeness' },
        ],
    },
    {
        id: 'date-query-whats-due-this-week',
        name: 'Query reads dated entities relative to the pinned clock',
        category: 'dates',
        referenceDate: REF,
        vaultSeed: [
            { entityType: 'task', title: 'Overdue: file taxes', fields: { dueDate: '2026-03-10', status: 'open' }, body: 'Was due last week.' },
            { entityType: 'task', title: 'Pay rent', fields: { dueDate: '2026-03-16', status: 'open' }, body: 'Due tomorrow.' },
            { entityType: 'task', title: 'Book flights', fields: { dueDate: '2026-03-19', status: 'open' }, body: 'Due Thursday.' },
            { entityType: 'task', title: 'Spring cleaning', fields: { dueDate: '2026-05-01', status: 'open' }, body: 'Weeks away.' },
        ],
        userInput: 'What tasks are due this week?',
        assertions: [
            { type: 'response_contains', match: 'rent', description: 'Pay rent (3/16) is this week' },
            { type: 'response_contains', match: 'flights', description: 'Book flights (3/19) is this week' },
            { type: 'response_not_contains', match: 'Spring cleaning', description: 'The May task is not this week' },
            { type: 'response_faithful', description: 'Claims about which tasks are due this week are grounded in the vault' },
        ],
    },
];
