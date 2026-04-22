// ─────────────────────────────────────────────────────────────────────────────
// Recurrence Entity Type — auto-registration helper
// ─────────────────────────────────────────────────────────────────────────────
// Extracted from commands/recurrence.ts so it can be imported without pulling
// in commander/chalk/inquirer (which don't work in Expo).
import { getEntityType, addEntityType } from './entity-type-config.js';
/**
 * Auto-register the "recurrence" entity type if it doesn't exist yet.
 */
export async function ensureRecurrenceType() {
    const existing = await getEntityType('recurrence');
    if (existing)
        return;
    await addEntityType({
        name: 'recurrence',
        plural: 'recurrences',
        directory: 'recurrences',
        description: 'Recurring task/event templates that spawn concrete instances',
        fields: [
            { key: 'cadence', type: 'enum', label: 'Cadence', values: ['daily', 'weekly', 'monthly'], default: 'weekly', required: true },
            { key: 'cadenceDetails', type: 'string', label: 'Cadence Details' },
            { key: 'targetType', type: 'enum', label: 'Target Type', values: ['task', 'event'], default: 'task' },
            { key: 'priority', type: 'enum', label: 'Priority', values: ['low', 'medium', 'high', 'critical'], default: 'medium' },
            { key: 'status', type: 'enum', label: 'Status', values: ['active', 'paused'], default: 'active' },
            { key: 'blackoutWindows', type: 'string', label: 'Blackout Windows' },
        ],
        spawner: {
            mode: 'date-series',
            targetTypeField: 'targetType',
            titlePattern: '{title} — {YYYY-MM-DD}',
            dedupeFields: ['title', 'dueDate'],
            scheduling: {
                cadenceField: 'cadence',
                cadenceDetailsField: 'cadenceDetails',
                blackoutField: 'blackoutWindows',
            },
            fieldMapping: [
                { from: 'priority', to: 'priority' },
                { value: 'open', to: 'status' },
                { value: '{date}', to: 'dueDate' },
            ],
        },
    });
}
