// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Create Recurring Task NodeCode
// ─────────────────────────────────────────────────────────────────────────────
//
// Creates a recurrence entity and immediately spawns concrete task/event
// instances via the spawner system.
// ─────────────────────────────────────────────────────────────────────────────
import { getPlatform } from '../../../platform/index.js';
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { generateEntityId, ensureEntityDir, writeEntity, entityFilename, } from '../../../entities/entity.js';
import { getEntityType } from '../../../entities/entity-type-config.js';
import { getEntityIndex } from '../../../entities/entity-index.js';
import { spawn } from '../../../entities/spawner.js';
import { ensureRecurrenceType } from '../../../entities/recurrence-type.js';
export class CreateRecurringTaskNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'entity_title', name: 'Title', description: 'Title for the recurrence. Falls back to context "title".', type: 'string', isOptional: true },
        { key: 'cadence', name: 'Cadence', description: 'daily, weekly, or monthly (default: weekly).', type: 'string', isOptional: true },
        { key: 'priority', name: 'Priority', description: 'Default priority for spawned tasks (default: medium).', type: 'string', isOptional: true },
        { key: 'day_of_week', name: 'Day of Week', description: 'For weekly cadence: monday–sunday.', type: 'string', isOptional: true },
        { key: 'day_of_month', name: 'Day of Month', description: 'For monthly cadence: 1–31.', type: 'string', isOptional: true },
        { key: 'entity_body', name: 'Body', description: 'Template body content for spawned entities.', type: 'string', isOptional: true },
        { key: 'target_type', name: 'Target Type', description: 'Entity type to spawn: task or event (default: task).', type: 'string', isOptional: true },
        { key: 'spawn_days', name: 'Spawn Days', description: 'Days ahead to generate instances (default: 60).', type: 'string', isOptional: true },
    ];
    static resultDescriptions = [
        { status: ResultStatus.OK, description: 'Recurrence created and instances spawned.' },
        { status: ResultStatus.ERROR, description: 'Failed to create recurrence.' },
    ];
    constructor() {
        super('create_recurring_task', 'Create Recurring Task', 'Creates a recurring task/event with a recurrence template and spawns concrete instances.', NodeCodeCategory.DATA);
    }
    async process(context) {
        // Ensure the recurrence entity type is registered
        await ensureRecurrenceType();
        // ── Resolve title ────────────────────────────────────────────────
        const configTitle = this.getOptionalConfigValue('entity_title');
        if (configTitle) {
            context.set('title', this.interpolate(configTitle, context));
        }
        const title = context.get('title');
        if (!title) {
            context.set('error', 'No title provided in context.');
            return this.result(ResultStatus.ERROR, 'Missing title in context.');
        }
        // ── Resolve config values ────────────────────────────────────────
        const cadence = this.resolveValue('cadence', context, 'weekly');
        const priority = this.resolveValue('priority', context, 'medium');
        const dayOfWeek = this.resolveValue('day_of_week', context, null);
        const dayOfMonth = this.resolveValue('day_of_month', context, null);
        const targetType = this.resolveValue('target_type', context, 'task');
        const spawnDays = Number(this.resolveValue('spawn_days', context, '60')) || 60;
        const configBody = this.getOptionalConfigValue('entity_body');
        const body = configBody ? this.interpolate(configBody, context) : (context.get('content') ?? '');
        // ── Build cadenceDetails ─────────────────────────────────────────
        const cadenceDetails = {};
        if (dayOfWeek)
            cadenceDetails.dayOfWeek = dayOfWeek;
        if (dayOfMonth)
            cadenceDetails.dayOfMonth = Number(dayOfMonth);
        // ── Create recurrence entity file ────────────────────────────────
        const dir = await ensureEntityDir('recurrence');
        const id = generateEntityId('recurrence');
        const filepath = getPlatform().paths.join(dir, entityFilename(title, id));
        const meta = {
            id,
            title,
            entityType: 'recurrence',
            created: new Date().toISOString(),
            tags: ['recurring'],
            cadence,
            cadenceDetails,
            targetType,
            priority,
            status: 'active',
            blackoutWindows: [],
        };
        await writeEntity(filepath, meta, body);
        // Update entity index
        const index = getEntityIndex();
        if (index.isBuilt) {
            await index.addOrUpdate('recurrence', id, title, filepath);
        }
        // ── Spawn concrete instances ─────────────────────────────────────
        const recurrenceTypeConfig = await getEntityType('recurrence');
        // Build a spawner config matching what the spawner expects
        const spawnerConfig = recurrenceTypeConfig?.spawner ?? {
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
        };
        const template = {
            filepath,
            meta,
            content: body,
        };
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const endDate = new Date(today);
        endDate.setDate(endDate.getDate() + spawnDays);
        let spawnResult = { created: 0, skipped: 0 };
        try {
            spawnResult = await spawn(template, spawnerConfig, {
                startDate: today,
                endDate,
            });
        }
        catch (err) {
            context.set('error', `Recurrence created but spawning failed: ${err}`);
            context.set('recurringTask', { id, title, cadence });
            context.set('spawnResult', { created: 0, skipped: 0, error: String(err) });
            return this.result(ResultStatus.ERROR, `Recurrence "${title}" created but spawn failed: ${err}`);
        }
        // ── Set context for downstream nodes ─────────────────────────────
        context.set('recurringTask', { id, title, cadence });
        context.set('spawnResult', spawnResult);
        context.set('filepath', filepath);
        return this.result(ResultStatus.OK, `Created recurrence "${title}" (${cadence}) and spawned ${spawnResult.created} ${targetType}(s), ${spawnResult.skipped} skipped.`);
    }
    /**
     * Resolve a value from config → context → fallback.
     */
    resolveValue(key, context, fallback) {
        const configVal = this.getOptionalConfigValue(key);
        if (configVal)
            return this.interpolate(configVal, context);
        const contextVal = context.get(key);
        if (contextVal)
            return contextVal;
        return fallback;
    }
}
