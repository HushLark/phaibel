// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — List Entities NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { listEntities } from '../../../entities/entity.js';
export class ListEntitiesNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'entity_type', name: 'Entity Type', description: 'The entity type to list (any configured entity type, e.g. task, note, event, goal).', type: 'string' },
        { key: 'tags', name: 'Tags', description: 'Comma-separated tag names to filter by (case-insensitive exact match). Only entities with at least one matching tag are returned.', type: 'string', isOptional: true },
        { key: 'context_path', name: 'Context Path', description: 'Context key to store the entity list.', type: 'string', default: 'entities' },
    ];
    static resultDescriptions = [
        { status: ResultStatus.OK, description: 'Entities listed successfully.' },
        { status: ResultStatus.ERROR, description: 'Failed to list entities.' },
    ];
    constructor() {
        super('list_entities', 'List Entities', 'Lists all entities of a given type in the active project.', NodeCodeCategory.DATA);
    }
    async process(context) {
        const entityType = this.getRequiredConfigValue('entity_type');
        const contextPath = this.getRequiredConfigValue('context_path', 'entities');
        const tagsRaw = this.getOptionalConfigValue('tags');
        const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : undefined;
        try {
            const entities = await listEntities(entityType, tags ? { tags } : undefined);
            const result = entities.map(e => ({
                title: e.meta.title,
                filepath: e.filepath,
                content: e.content,
                ...e.meta,
            }));
            context.set(contextPath, result);
            return this.result(ResultStatus.OK, `Listed ${result.length} ${entityType}(s).`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            context.set('error', message);
            return this.result(ResultStatus.ERROR, `Failed to list ${entityType}: ${message}`);
        }
    }
}
