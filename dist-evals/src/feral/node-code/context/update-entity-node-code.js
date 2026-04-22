// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Update Entity NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { findEntityByTitle, writeEntity } from '../../../entities/entity.js';
import { getEntityType } from '../../../entities/entity-type-config.js';
import { validateEntity, formatValidationErrors } from '../../../entities/entity-validator.js';
import { getEntityIndex } from '../../../entities/entity-index.js';
import { getEmbeddingIndex } from '../../../entities/embedding-index.js';
import { generateEntitySummary } from '../../../entities/entity-summary.js';
const NOT_FOUND = 'not_found';
export class UpdateEntityNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'entity_type', name: 'Entity Type', description: 'The entity type to update (any configured entity type, e.g. task, note, event, goal).', type: 'string' },
        { key: 'entity_title', name: 'Entity Title', description: 'Title of the entity to update. Supports {context_key} interpolation. Sets "title" in context.', type: 'string', isOptional: true },
        { key: 'entity_body', name: 'Entity Body', description: 'New body/content for the entity. Supports {context_key} interpolation. Sets "content" in context.', type: 'string', isOptional: true },
        { key: 'patch_fields', name: 'Patch Fields', description: 'Comma-separated context keys to merge into entity metadata (e.g. status,priority,dueDate).', type: 'string', default: '', isOptional: true },
        { key: 'add_tags', name: 'Add Tags', description: 'Comma-separated tags to append to the entity (preserves existing tags). E.g. "year-of-the-house,outdoor".', type: 'string', isOptional: true },
    ];
    static resultDescriptions = [
        { status: ResultStatus.OK, description: 'Entity updated successfully.' },
        { status: NOT_FOUND, description: 'Entity not found.' },
    ];
    /** Accept any extra config keys that match patch field names */
    get allowExtraConfig() { return true; }
    constructor() {
        super('update_entity', 'Update Entity', 'Updates an existing entity by title.', NodeCodeCategory.DATA);
    }
    async process(context) {
        const entityType = this.getRequiredConfigValue('entity_type');
        const patchFieldsStr = this.getOptionalConfigValue('patch_fields', '');
        // Bridge config → context: if entity_title/entity_body are set in config,
        // interpolate and write them into context so the rest of the logic works.
        const configTitle = this.getOptionalConfigValue('entity_title');
        const configBody = this.getOptionalConfigValue('entity_body');
        if (configTitle) {
            context.set('title', this.interpolate(configTitle, context));
        }
        if (configBody) {
            context.set('content', this.interpolate(configBody, context));
        }
        // Bridge patch field values from config → context.
        // Config values OVERRIDE context (e.g. when array_iterator spreads stale values).
        if (patchFieldsStr) {
            for (const field of patchFieldsStr.split(',').map(f => f.trim()).filter(Boolean)) {
                const configVal = this.getOptionalConfigValue(field);
                if (configVal) {
                    context.set(field, this.interpolate(configVal, context));
                }
            }
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
        // Merge content if provided
        const newContent = context.get('content');
        const content = newContent !== undefined ? newContent : (found.content ?? '');
        // Merge patch fields from context into existing metadata
        if (patchFieldsStr) {
            for (const field of patchFieldsStr.split(',').map(f => f.trim()).filter(Boolean)) {
                const val = context.get(field);
                if (val !== undefined) {
                    found.meta[field] = val;
                }
            }
        }
        // Append tags from add_tags config (preserves existing)
        const addTagsStr = this.getOptionalConfigValue('add_tags');
        if (addTagsStr) {
            const newTags = addTagsStr.split(',').map(t => this.interpolate(t.trim(), context)).filter(Boolean);
            const existing = Array.isArray(found.meta.tags) ? found.meta.tags : [];
            const merged = [...new Set([...existing, ...newTags])];
            found.meta.tags = merged;
        }
        // Replace tags if explicitly set in context (only when add_tags is not used)
        if (!addTagsStr) {
            const tags = context.get('tags');
            if (tags)
                found.meta.tags = tags;
        }
        // Validate only the patched fields against entity type schema
        const typeConfig = await getEntityType(entityType);
        if (typeConfig) {
            const patchedFields = new Set(patchFieldsStr ? patchFieldsStr.split(',').map(f => f.trim()).filter(Boolean) : []);
            // Also validate content-related fields if content was changed
            if (newContent !== undefined)
                patchedFields.add('content');
            const errors = validateEntity(found.meta, typeConfig, false, patchedFields.size > 0 ? patchedFields : undefined);
            if (errors.length > 0) {
                const msg = `Validation failed for ${entityType}: ${formatValidationErrors(errors)}`;
                context.set('error', msg);
                return this.result(ResultStatus.ERROR, msg);
            }
        }
        await writeEntity(found.filepath, found.meta, content);
        // Regenerate summary with updated content
        const summary = await generateEntitySummary(entityType, found.meta.title ?? title, content, found.meta);
        found.meta.summary = summary;
        await writeEntity(found.filepath, found.meta, content);
        context.set('entity', {
            filepath: found.filepath,
            content,
            ...found.meta,
        });
        // Update entity index incrementally
        const index = getEntityIndex();
        if (index.isBuilt) {
            const entityId = found.meta.id;
            const updatedTags = Array.isArray(found.meta.tags) ? found.meta.tags : [];
            await index.addOrUpdate(entityType, entityId, title, found.filepath, updatedTags, summary);
        }
        // Update embedding index
        const embeddingIndex = getEmbeddingIndex();
        if (embeddingIndex.isLoaded) {
            const id = found.meta.id;
            const updatedTags = Array.isArray(found.meta.tags) ? found.meta.tags : [];
            await embeddingIndex.upsert(`${entityType}:${id}`, { title, tags: updatedTags, summary: summary ?? '', bodySnippet: '' });
        }
        return this.result(ResultStatus.OK, `Updated ${entityType} "${title}".`);
    }
}
