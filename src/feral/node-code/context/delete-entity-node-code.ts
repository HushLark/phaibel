// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Delete Entity NodeCode
// ─────────────────────────────────────────────────────────────────────────────

import { getPlatform } from '../../../platform/index.js';
import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { findEntityByTitle, findNodeAnyType, trashEntity, type EntityTypeName } from '../../../entities/entity.js';
import { getEntityIndex } from '../../../entities/entity-index.js';
import { getEmbeddingIndex } from '../../../entities/embedding-index.js';

const NOT_FOUND = 'not_found';

export class DeleteEntityNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'entity_type', name: 'Entity Type', description: 'The entity type to delete (any configured entity type, e.g. task, note, event, goal).', type: 'string' },
        { key: 'entity_title', name: 'Entity Title', description: 'Title of the entity to delete. Supports {context_key} interpolation.', type: 'string', isOptional: true },
    ];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Entity deleted successfully.' },
        { status: NOT_FOUND, description: 'Entity not found.' },
    ];

    constructor() {
        super('delete_entity', 'Delete Entity', 'Deletes an entity by title.', NodeCodeCategory.DATA);
    }

    async process(context: Context): Promise<Result> {
        const entityType = this.getRequiredConfigValue('entity_type') as EntityTypeName;

        // Read title from config (preferred) or context
        const configTitle = this.getOptionalConfigValue('entity_title') as string | null;
        if (configTitle) {
            context.set('title', this.interpolate(configTitle, context));
        }

        const title = context.get('title') as string;
        if (!title) {
            context.set('error', 'No title provided in context.');
            return this.result(NOT_FOUND, 'Missing title in context.');
        }

        // Resolve in the requested type; fall back across the type hierarchy so a
        // node moved to a subtype (e.g. person → family) is still found.
        let found = await findEntityByTitle(entityType, title);
        let effectiveType: string = entityType;
        if (!found) {
            const any = await findNodeAnyType(title, entityType);
            if (any) { found = any; effectiveType = any.entityType; }
        }
        if (!found) {
            context.set('error', `${entityType} "${title}" not found.`);
            return this.result(NOT_FOUND, `${entityType} "${title}" not found.`);
        }

        await trashEntity(found.filepath);

        // Update entity index incrementally
        const index = getEntityIndex();
        if (index.isBuilt) {
            index.remove(effectiveType as EntityTypeName, found.meta.id as string);
        }

        // Update embedding index
        const embeddingIndex = getEmbeddingIndex();
        if (embeddingIndex.isLoaded) {
            const id = found.meta.id as string;
            embeddingIndex.remove(`${effectiveType}:${id}`);
        }

        context.set('deleted', {
            filepath: found.filepath,
            title: found.meta.title,
            deleted: true,
        });

        return this.result(ResultStatus.OK, `Deleted ${effectiveType} "${title}".`);
    }
}
