// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT ENTITY TYPE DEFINITIONS
// Only the two built-in types: task (todos) and note.
// All other types are user-defined via `phaibel type add`.
// ─────────────────────────────────────────────────────────────────────────────

import type { EntityTypeConfig } from './entity-type-config.js';

export const DEFAULT_ENTITY_TYPES: EntityTypeConfig[] = [
    {
        name: 'task',
        baseCategory: 'task',
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
        temporal: {
            anchor: 'date',
            field: 'dueDate',
            // Show overdue tasks up to 30 days back; upcoming up to 180 days ahead.
            // No deleteAfterDays — tasks persist until explicitly completed or deleted.
            windowDaysBefore: 30,
            windowDaysAfter: 180,
        },
        // Event/Task category (see docs/RELEVANCE-DIMENSIONS.md §3): time window +
        // goal service dominate. Undated tasks have no temporal dim → timeless.
        dimensions: [
            { type: 'temporal',         weight: 3, config: { anchor: 'point', startField: 'dueDate', windowBefore: 2, windowAfter: 60 } },
            { type: 'goalAlignment',    weight: 3 },
            { type: 'semantic',         weight: 2 },
            { type: 'socialProximity',  weight: 2 },
            { type: 'contextProximity', weight: 2 },
            { type: 'recency',          weight: 2 },
            { type: 'behavioral',       weight: 1 },
        ],
    },
    {
        name: 'note',
        baseCategory: 'thing',
        plural: 'notes',
        directory: 'notes',
        description: 'Free-form notes and references',
        defaultTags: ['note'],
        fields: [],
        // Notes have no temporal anchor — always include in context.
        // Thing category: found by content + graph-linkage to current work.
        dimensions: [
            { type: 'semantic',         weight: 3 },
            { type: 'contextProximity', weight: 3 },
            { type: 'goalAlignment',    weight: 2 },
            { type: 'behavioral',       weight: 2 },
            { type: 'recency',          weight: 2 },
            { type: 'socialProximity',  weight: 1 },
        ],
    },
    {
        name: 'event',
        baseCategory: 'event',
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
        temporal: {
            anchor: 'datetime',
            field: 'startDate',
            durationField: 'duration',
            // Show events from 3 days ago (for follow-ups) to 60 days ahead.
            // Archive 14 days after the event date.
            windowDaysBefore: 3,
            windowDaysAfter: 60,
            deleteAfterDays: 14,
        },
        // Event/Task category (period anchor). Salience peaks during the event,
        // cools after. location is a free-text string, so no spatial dimension.
        dimensions: [
            { type: 'temporal',         weight: 3, config: { anchor: 'period', startField: 'startDate', durationField: 'duration', windowBefore: 3, windowAfter: 14, archiveDelay: 30 } },
            { type: 'semantic',         weight: 2 },
            { type: 'socialProximity',  weight: 2 },
            { type: 'goalAlignment',    weight: 2 },
            { type: 'contextProximity', weight: 2 },
            { type: 'recency',          weight: 2 },
            { type: 'behavioral',       weight: 1 },
        ],
    },
    {
        name: 'person',
        baseCategory: 'human',
        plural: 'people',
        directory: 'people',
        description: 'People — contacts, colleagues, family, friends',
        defaultTags: ['person'],
        fields: [
            { key: 'lastName',     type: 'string',     label: 'Last Name',        required: false },
            { key: 'nickname',     type: 'string',     label: 'Nickname / AKA',   required: false },
            { key: 'type',         type: 'string',     label: 'Relationship Type', required: false },
            { key: 'email',        type: 'string',     label: 'Email',            required: false },
            { key: 'phone',        type: 'string',     label: 'Phone',            required: false },
            { key: 'handle',       type: 'string',     label: 'Handle',           required: false },
            { key: 'company',      type: 'reference',  label: 'Company',          targetType: 'company', required: false },
            { key: 'birthday',     type: 'date-fixed', label: 'Birthday',         required: false },
        ],
        // Human category: closeness to you (me-anchored, refined by the 'type'
        // relationship field) and interaction frequency dominate. Timeless.
        dimensions: [
            { type: 'socialProximity',  weight: 3, config: { field: 'type' } },
            { type: 'behavioral',       weight: 3 },
            { type: 'semantic',         weight: 2 },
            { type: 'contextProximity', weight: 2 },
            { type: 'recency',          weight: 2 },
            { type: 'goalAlignment',    weight: 1 },
        ],
    },
    {
        name: 'company',
        baseCategory: 'thing',
        plural: 'companies',
        directory: 'companies',
        description: 'Companies and organizations',
        defaultTags: ['company'],
        fields: [
            { key: 'website',        type: 'string',    label: 'Website',         required: false },
            { key: 'industry',       type: 'string',    label: 'Industry',        required: false },
            { key: 'size',           type: 'enum',      label: 'Size',
              values: ['micro', 'small', 'medium', 'large', 'enterprise'],         required: false },
            { key: 'phone',          type: 'string',    label: 'Phone',           required: false },
            { key: 'email',          type: 'string',    label: 'Email',           required: false },
            { key: 'location',       type: 'string',    label: 'Location',        required: false },
            { key: 'primaryContact', type: 'reference', label: 'Primary Contact', targetType: 'person', required: false },
        ],
        // Thing/organization: found by name + graph-linkage to deals and people.
        dimensions: [
            { type: 'semantic',         weight: 3 },
            { type: 'contextProximity', weight: 3 },
            { type: 'behavioral',       weight: 2 },
            { type: 'goalAlignment',    weight: 2 },
            { type: 'recency',          weight: 2 },
            { type: 'socialProximity',  weight: 1 },
        ],
    },
    {
        name: 'todont',
        baseCategory: 'thing',
        plural: 'todonts',
        directory: 'todonts',
        description: 'Things to deliberately NOT do',
        defaultTags: ['todont'],
        fields: [
            { key: 'reason', type: 'string', label: 'Reason', required: false },
        ],
        // Thing category, rarely retrieved by ranking — content match only.
        dimensions: [
            { type: 'semantic',         weight: 2 },
            { type: 'contextProximity', weight: 1 },
            { type: 'recency',          weight: 1 },
        ],
    },
    {
        name: 'goal',
        baseCategory: 'goal',
        plural: 'goals',
        directory: 'goals',
        description: 'Outcomes you are working toward — the "why" that tasks and events serve',
        defaultTags: ['goal'],
        fields: [
            { key: 'status',     type: 'enum', label: 'Status', values: ['active', 'achieved', 'abandoned'], default: 'active', required: true },
            { key: 'priority',   type: 'enum', label: 'Priority', values: ['low', 'medium', 'high'], default: 'medium', required: true },
            { key: 'targetDate', type: 'date', label: 'Target Date', required: false },
        ],
        completionField: 'status',
        completionValue: 'achieved',
        // Inherits the 'goal' base-category relevance profile (long-horizon, hub).
    },
];

/** Names of built-in types that cannot be removed. */
export const BUILT_IN_TYPE_NAMES = new Set(['task', 'note', 'event', 'person', 'company', 'todont', 'goal']);
