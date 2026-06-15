// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Complete Entity NodeCode
// ─────────────────────────────────────────────────────────────────────────────
//
// A convenience NodeCode that finds an entity by title and marks it complete
// in a single step. This avoids the fragile context-threading between
// find_entity → update_entity that LLMs often get wrong.
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { findEntityByTitle, writeEntity, type EntityTypeName } from '../../../entities/entity.js';
import { getEntityIndex } from '../../../entities/entity-index.js';
import { getEmbeddingIndex } from '../../../entities/embedding-index.js';

const NOT_FOUND = 'not_found';

export class CompleteEntityNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'entity_type', name: 'Entity Type', description: 'The entity type to complete (task, goal, research).', type: 'string' },
        { key: 'entity_title', name: 'Entity Title', description: 'Title of the entity to mark complete. Supports {context_key} interpolation.', type: 'string', isOptional: true },
    ];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Entity marked complete.' },
        { status: NOT_FOUND, description: 'Entity not found.' },
    ];

    constructor() {
        super('complete_entity', 'Complete Entity', 'Finds an entity by title and marks it as complete.', NodeCodeCategory.DATA);
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
            context.set('error', 'No title provided.');
            return this.result(NOT_FOUND, 'Missing title — provide entity_title config or set "title" in context.');
        }

        const found = await findEntityByTitle(entityType, title);
        if (!found) {
            context.set('error', `${entityType} "${title}" not found.`);
            return this.result(NOT_FOUND, `${entityType} "${title}" not found.`);
        }

        // Mark complete
        found.meta.status = 'complete';
        await writeEntity(found.filepath, found.meta, found.content ?? '');

        context.set('entity', {
            filepath: found.filepath,
            content: found.content ?? '',
            ...found.meta,
        });

        // Update entity index
        const index = getEntityIndex();
        if (index.isBuilt) {
            const entityId = found.meta.id as string;
            const summary = (found.meta.summary as string) ?? '';
            await index.addOrUpdate(entityType, entityId, title, found.filepath, summary);
        }

        // Update embedding index
        const embeddingIndex = getEmbeddingIndex();
        if (embeddingIndex.isLoaded) {
            const id = found.meta.id as string;
            const summary = (found.meta.summary as string) ?? '';
            await embeddingIndex.upsert(`${entityType}:${id}`, { title, summary, bodySnippet: (found.content ?? '').slice(0, 500) });
        }

        return this.result(ResultStatus.OK, `Marked ${entityType} "${title}" as complete.`);
    }
}
