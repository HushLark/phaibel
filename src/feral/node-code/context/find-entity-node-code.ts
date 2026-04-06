// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Find Entity NodeCode
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { findEntityByTitle, type EntityTypeName } from '../../../entities/entity.js';

/**
 * Custom result status for "not found" branching.
 */
const NOT_FOUND = 'not_found';

export class FindEntityNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'entity_type', name: 'Entity Type', description: 'The entity type to search (any configured entity type, e.g. task, note, event, goal).', type: 'string' },
        { key: 'entity_title', name: 'Entity Title', description: 'Title/filename to search for. Supports {context_key} interpolation. Sets the title in context.', type: 'string', isOptional: true },
        { key: 'title_context_key', name: 'Title Context Key', description: 'Context key holding the title/filename to search for.', type: 'string', default: 'title' },
        { key: 'context_path', name: 'Context Path', description: 'Context key to store the found entity.', type: 'string', default: 'entity' },
    ];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Entity found.' },
        { status: NOT_FOUND, description: 'Entity not found.' },
    ];

    /** Accept extra config keys (e.g. LLM putting "title" directly in config) */
    get allowExtraConfig(): boolean { return true; }

    constructor() {
        super('find_entity', 'Find Entity', 'Finds an entity by title or filename.', NodeCodeCategory.DATA);
    }

    async process(context: Context): Promise<Result> {
        const entityType = this.getRequiredConfigValue('entity_type') as EntityTypeName;
        const titleKey = this.getRequiredConfigValue('title_context_key', 'title') as string;
        const contextPath = this.getRequiredConfigValue('context_path', 'entity') as string;

        // Bridge config → context: LLMs often put the title in config
        const configTitle = this.getOptionalConfigValue('entity_title') as string | null;
        const configTitleDirect = this.getOptionalConfigValue('title') as string | null;
        if (configTitle) {
            context.set(titleKey, this.interpolate(configTitle, context));
        } else if (configTitleDirect) {
            context.set(titleKey, this.interpolate(configTitleDirect, context));
        }

        const title = context.get(titleKey) as string;
        if (!title) {
            context.set('error', `No title found in context at "${titleKey}".`);
            return this.result(NOT_FOUND, `No title provided at context key "${titleKey}".`);
        }

        const found = await findEntityByTitle(entityType, title);
        if (!found) {
            context.set('error', `${entityType} "${title}" not found.`);
            return this.result(NOT_FOUND, `${entityType} "${title}" not found.`);
        }

        context.set(contextPath, {
            filepath: found.filepath,
            content: found.content,
            ...found.meta,
        });

        return this.result(ResultStatus.OK, `Found ${entityType} "${title}".`);
    }
}
