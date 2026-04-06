// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Set Entity Field NodeCode
// ─────────────────────────────────────────────────────────────────────────────
//
// Sets a single field on an entity found by title.
// Designed for catalog nodes that target a specific entity type and field —
// e.g. a "complete_todo" catalog node: entity_type=task, field=status, value=complete.
//
// The entity title is resolved from:
//   1. entity_title config value (supports {context_key} interpolation)
//   2. context key "title" as fallback
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { findEntityByTitle, writeEntity, type EntityTypeName } from '../../../entities/entity.js';
import { getEntityIndex } from '../../../entities/entity-index.js';

const NOT_FOUND = 'not_found';

export class SetEntityFieldNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'entity_type', name: 'Entity Type', description: 'The entity type to target (e.g. task, note, car).', type: 'string' },
        { key: 'field', name: 'Field', description: 'The field name to set (e.g. status, priority, completed).', type: 'string' },
        { key: 'value', name: 'Value', description: 'The value to set. Supports {context_key} interpolation.', type: 'string' },
        { key: 'entity_title', name: 'Entity Title', description: 'Title of the entity to update. Supports {context_key} interpolation. Falls back to context "title".', type: 'string', isOptional: true },
    ];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Field set successfully.' },
        { status: NOT_FOUND, description: 'Entity not found.' },
    ];

    constructor() {
        super(
            'set_entity_field',
            'Set Entity Field',
            'Sets a single field on an entity found by title. Use this to create focused catalog nodes like "complete_todo" or "set_priority".',
            NodeCodeCategory.DATA,
        );
    }

    async process(context: Context): Promise<Result> {
        const entityType = this.getRequiredConfigValue('entity_type') as EntityTypeName;
        const field = this.getRequiredConfigValue('field') as string;
        const rawValue = this.getRequiredConfigValue('value') as string;
        const value = this.interpolate(rawValue, context);

        // Resolve title from config or context
        const configTitle = this.getOptionalConfigValue('entity_title') as string | null;
        const title = configTitle
            ? this.interpolate(configTitle, context)
            : context.get('title') as string;

        if (!title) {
            context.set('error', 'No entity title provided. Set entity_title config or "title" in context.');
            return this.result(NOT_FOUND, 'Missing entity title.');
        }

        const found = await findEntityByTitle(entityType, title);
        if (!found) {
            context.set('error', `${entityType} "${title}" not found.`);
            return this.result(NOT_FOUND, `${entityType} "${title}" not found.`);
        }

        // Set the field and persist
        found.meta[field] = value;
        await writeEntity(found.filepath, found.meta, found.content ?? '');

        context.set('entity', { filepath: found.filepath, content: found.content ?? '', ...found.meta });
        context.set(field, value);

        // Update entity index
        const index = getEntityIndex();
        if (index.isBuilt) {
            await index.addOrUpdate(entityType, String(found.meta.id ?? title), title, found.filepath);
        }

        return this.result(ResultStatus.OK, `Set ${entityType} "${title}" ${field} = ${value}.`);
    }
}
