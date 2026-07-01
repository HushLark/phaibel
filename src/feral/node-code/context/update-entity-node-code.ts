// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Update Entity NodeCode
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { findEntityByTitle, findNodeAnyType, writeEntity, type EntityTypeName } from '../../../entities/entity.js';
import { getEntityType } from '../../../entities/entity-type-config.js';
import { validateEntity, formatValidationErrors } from '../../../entities/entity-validator.js';
import { getEntityIndex } from '../../../entities/entity-index.js';
import { getEmbeddingIndex } from '../../../entities/embedding-index.js';
import { generateEntitySummary } from '../../../entities/entity-summary.js';

const NOT_FOUND = 'not_found';

export class UpdateEntityNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'entity_type', name: 'Entity Type', description: 'The entity type to update (any configured entity type, e.g. task, note, event, goal).', type: 'string' },
        { key: 'entity_title', name: 'Entity Title', description: 'Title of the entity to update. Supports {context_key} interpolation. Sets "title" in context.', type: 'string', isOptional: true },
        { key: 'entity_body', name: 'Entity Body', description: 'New body/content for the entity. Supports {context_key} interpolation. Sets "content" in context.', type: 'string', isOptional: true },
        { key: 'patch_fields', name: 'Patch Fields', description: 'Comma-separated context keys to merge into entity metadata (e.g. status,priority,dueDate).', type: 'string', default: '', isOptional: true },
    ];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Entity updated successfully.' },
        { status: NOT_FOUND, description: 'Entity not found.' },
    ];

    /** Accept any extra config keys that match patch field names */
    get allowExtraConfig(): boolean { return true; }

    constructor() {
        super('update_entity', 'Update Entity', 'Updates an existing entity by title.', NodeCodeCategory.DATA);
    }

    async process(context: Context): Promise<Result> {
        const entityType = this.getRequiredConfigValue('entity_type') as EntityTypeName;
        const patchFieldsStr = this.getOptionalConfigValue('patch_fields', '') as string;

        // Bridge config → context: if entity_title/entity_body are set in config,
        // interpolate and write them into context so the rest of the logic works.
        const configTitle = this.getOptionalConfigValue('entity_title') as string | null;
        const configBody = this.getOptionalConfigValue('entity_body') as string | null;
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
                const configVal = this.getOptionalConfigValue(field) as string | null;
                if (configVal) {
                    context.set(field, this.interpolate(configVal, context));
                }
            }
        }

        const title = context.get('title') as string;
        if (!title) {
            context.set('error', 'No title provided in context.');
            return this.result(NOT_FOUND, 'Missing title in context.');
        }

        // Look up by title in the requested type; if missing, fall back across the
        // context-type hierarchy so a node moved to a subtype (e.g. person → family)
        // is still found and updated instead of silently failing.
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

        // Merge content only if a real string was provided — a null/undefined (or
        // non-string) "content" in context must NOT clobber the existing body
        // (that's how a rename wiped a node's body to the literal "null").
        const newContent = context.get('content');
        const content = typeof newContent === 'string' ? newContent : (found.content ?? '');

        // Merge patch fields from context into existing metadata
        if (patchFieldsStr) {
            for (const field of patchFieldsStr.split(',').map(f => f.trim()).filter(Boolean)) {
                const val = context.get(field);
                if (val !== undefined) {
                    found.meta[field] = val;
                }
            }
        }

        // Validate only the patched fields against entity type schema
        const typeConfig = await getEntityType(effectiveType);
        if (typeConfig) {
            const patchedFields = new Set(
                patchFieldsStr ? patchFieldsStr.split(',').map(f => f.trim()).filter(Boolean) : []
            );
            // Also validate content-related fields if content was changed
            if (newContent !== undefined) patchedFields.add('content');
            const errors = validateEntity(found.meta, typeConfig, false, patchedFields.size > 0 ? patchedFields : undefined);
            if (errors.length > 0) {
                const msg = `Validation failed for ${effectiveType}: ${formatValidationErrors(errors)}`;
                context.set('error', msg);
                return this.result(ResultStatus.ERROR, msg);
            }
        }

        await writeEntity(found.filepath, found.meta, content);

        // Regenerate summary with updated content
        const summary = await generateEntitySummary(effectiveType as EntityTypeName, found.meta.title as string ?? title, content, found.meta);
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
            const entityId = found.meta.id as string;
            await index.addOrUpdate(effectiveType as EntityTypeName, entityId, title, found.filepath, summary);
        }

        // Update embedding index
        const embeddingIndex = getEmbeddingIndex();
        if (embeddingIndex.isLoaded) {
            const id = found.meta.id as string;
            await embeddingIndex.upsert(`${effectiveType}:${id}`, { title, summary: summary ?? '', bodySnippet: content.slice(0, 500) });
        }

        return this.result(ResultStatus.OK, `Updated ${effectiveType} "${title}".`);
    }
}
