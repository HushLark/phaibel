// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Delete Entity Type NodeCode
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { removeEntityType } from '../../../entities/entity-type-config.js';

const NOT_FOUND = 'not_found';
const PROTECTED = 'protected';

export class DeleteEntityTypeNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        {
            key: 'type_name',
            name: 'Type Name',
            description: 'The name of the entity type to delete. Supports {context_key} interpolation.',
            type: 'string',
        },
    ];

    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Entity type deleted successfully.' },
        { status: NOT_FOUND, description: 'Entity type not found.' },
        { status: PROTECTED, description: 'Entity type is built-in and cannot be deleted.' },
        { status: ResultStatus.ERROR, description: 'Failed to delete entity type.' },
    ];

    constructor() {
        super(
            'delete_entity_type',
            'Delete Entity Type',
            'Removes a custom entity type from the registry. Built-in types (task, note) are protected.',
            NodeCodeCategory.DATA,
        );
    }

    async process(context: Context): Promise<Result> {
        const rawName = this.getRequiredConfigValue('type_name') as string;
        const typeName = this.interpolate(rawName, context).trim();

        try {
            await removeEntityType(typeName);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('built-in')) {
                context.set('error', msg);
                return this.result(PROTECTED, msg);
            }
            if (msg.includes('not found')) {
                context.set('error', msg);
                return this.result(NOT_FOUND, msg);
            }
            context.set('error', msg);
            return this.result(ResultStatus.ERROR, msg);
        }

        context.set('deleted_type', typeName);
        return this.result(ResultStatus.OK, `Deleted entity type "${typeName}".`);
    }
}
