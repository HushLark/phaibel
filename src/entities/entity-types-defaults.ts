// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT ENTITY TYPE DEFINITIONS
// Only the two built-in types: task (todos) and note.
// All other types are user-defined via `phaibel type add`.
// ─────────────────────────────────────────────────────────────────────────────

import type { EntityTypeConfig } from './entity-type-config.js';

export const DEFAULT_ENTITY_TYPES: EntityTypeConfig[] = [
    {
        name: 'task',
        plural: 'tasks',
        directory: 'todos',
        description: 'Actionable items to complete',
        defaultTags: ['todo'],
        fields: [
            { key: 'status',   type: 'enum',   label: 'Status',
              values: ['open', 'in-progress', 'done', 'blocked'], default: 'open',   required: true },
            { key: 'priority', type: 'enum',   label: 'Priority',
              values: ['low', 'medium', 'high', 'critical'],       default: 'medium', required: true },
            { key: 'dueDate',  type: 'date',   label: 'Due Date',  required: false },
            { key: 'focusTime',    type: 'string', label: 'Focus Time',    required: false },
            { key: 'calendarDays', type: 'number', label: 'Calendar Days', required: false },
            { key: 'startDate',    type: 'date',   label: 'Start Date',    required: false },
        ],
        completionField: 'status',
        completionValue: 'done',
        calendarDateField: 'dueDate',
    },
    {
        name: 'note',
        plural: 'notes',
        directory: 'notes',
        description: 'Free-form notes and references',
        defaultTags: ['note'],
        fields: [],
    },
    {
        name: 'event',
        plural: 'events',
        directory: 'events',
        description: 'Calendar events and appointments',
        defaultTags: ['event'],
        fields: [
            { key: 'startDate', type: 'datetime', label: 'Start Time', required: true },
            { key: 'duration',  type: 'duration', label: 'Duration',   required: false },
            { key: 'location',  type: 'string',   label: 'Location',   required: false },
        ],
        calendarDateField: 'startDate',
    },
    {
        name: 'person',
        plural: 'people',
        directory: 'people',
        description: 'People — contacts, colleagues, family, friends',
        defaultTags: ['person'],
        fields: [
            { key: 'lastName', type: 'string', label: 'Last Name', required: false },
            { key: 'type',     type: 'string', label: 'Type',      required: false },
        ],
    },
    {
        name: 'todont',
        plural: 'todonts',
        directory: 'todonts',
        description: 'Things to deliberately NOT do',
        defaultTags: ['todont'],
        fields: [
            { key: 'reason', type: 'string', label: 'Reason', required: false },
        ],
    },
];

/** Names of built-in types that cannot be removed. */
export const BUILT_IN_TYPE_NAMES = new Set(['task', 'note', 'event', 'person', 'todont']);
