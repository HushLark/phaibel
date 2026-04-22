// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Delete Entity NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { findEntityByTitle, trashEntity } from '../../../entities/entity.js';
import { getEntityIndex } from '../../../entities/entity-index.js';
import { getEmbeddingIndex } from '../../../entities/embedding-index.js';
const NOT_FOUND = 'not_found';
export class DeleteEntityNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'entity_type', name: 'Entity Type', description: 'The entity type to delete (any configured entity type, e.g. task, note, event, goal).', type: 'string' },
        { key: 'entity_title', name: 'Entity Title', description: 'Title of the entity to delete. Supports {context_key} interpolation.', type: 'string', isOptional: true },
    ];
    static resultDescriptions = [
        { status: ResultStatus.OK, description: 'Entity deleted successfully.' },
        { status: NOT_FOUND, description: 'Entity not found.' },
    ];
    constructor() {
        super('delete_entity', 'Delete Entity', 'Deletes an entity by title.', NodeCodeCategory.DATA);
    }
    async process(context) {
        const entityType = this.getRequiredConfigValue('entity_type');
        // Read title from config (preferred) or context
        const configTitle = this.getOptionalConfigValue('entity_title');
        if (configTitle) {
            context.set('title', this.interpolate(configTitle, context));
        }
        const title = context.get('title');
        if (!title) {
            context.set('error', 'No title provided in context.');
            return this.result(NOT_FOUND, 'Missing title in context.');
        }
        const found = await findEntityByTitle(entityType, title);
        if (!found) {
            context.set('error', `${entityType} "${title}" not found.`);
            return this.result(NOT_FOUND, `${entityType} "${title}" not found.`);
        }
        await trashEntity(found.filepath);
        // Update entity index incrementally
        const index = getEntityIndex();
        if (index.isBuilt) {
            index.remove(entityType, found.meta.id);
        }
        // Update embedding index
        const embeddingIndex = getEmbeddingIndex();
        if (embeddingIndex.isLoaded) {
            const id = found.meta.id;
            embeddingIndex.remove(`${entityType}:${id}`);
        }
        context.set('deleted', {
            filepath: found.filepath,
            title: found.meta.title,
            deleted: true,
        });
        return this.result(ResultStatus.OK, `Deleted ${entityType} "${title}".`);
    }
}
