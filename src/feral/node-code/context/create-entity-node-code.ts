// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Create Entity NodeCode
// ─────────────────────────────────────────────────────────────────────────────

import { getPlatform } from '../../../platform/index.js';
import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import {
    generateEntityId,
    createEntityMeta,
    ensureEntityDir,
    findEntityByTitle,
    writeEntity,
    entityFilename,
    type EntityTypeName,
} from '../../../entities/entity.js';
import { getEntityType } from '../../../entities/entity-type-config.js';
import { validateEntity, formatValidationErrors } from '../../../entities/entity-validator.js';
import { getEntityIndex } from '../../../entities/entity-index.js';
import { getEmbeddingIndex } from '../../../entities/embedding-index.js';
import { generateEntitySummary } from '../../../entities/entity-summary.js';

/**
 * Custom result for duplicate detection.
 */
const ALREADY_EXISTS = 'already_exists';

export class CreateEntityNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'entity_type', name: 'Entity Type', description: 'The entity type to create (any configured entity type, e.g. task, note, event, goal).', type: 'string' },
        { key: 'entity_title', name: 'Entity Title', description: 'Title for the entity. Supports {context_key} interpolation. Sets "title" in context.', type: 'string', isOptional: true },
        { key: 'entity_body', name: 'Entity Body', description: 'Body/content for the entity. Supports {context_key} interpolation. Sets "content" in context.', type: 'string', isOptional: true },
        { key: 'extra_fields', name: 'Extra Fields', description: 'Comma-separated list of extra context keys to include in metadata (e.g. status,priority,dueDate).', type: 'string', default: '', isOptional: true },
    ];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Entity created successfully.' },
        { status: ALREADY_EXISTS, description: 'Entity with this title already exists.' },
        { status: ResultStatus.ERROR, description: 'Failed to create entity.' },
    ];

    constructor() {
        super('create_entity', 'Create Entity', 'Creates a new entity in the vault.', NodeCodeCategory.DATA);
    }

    async process(context: Context): Promise<Result> {
        const entityType = this.getRequiredConfigValue('entity_type') as EntityTypeName;
        const extraFieldsStr = this.getOptionalConfigValue('extra_fields', '') as string;

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

        const title = context.get('title') as string;
        if (!title) {
            context.set('error', 'No title provided in context.');
            return this.result(ResultStatus.ERROR, 'Missing title in context.');
        }

        // Check for duplicates
        // No semantic fallback here: a creation should only be blocked by a
        // real title match, not a semantically-similar sibling.
        const existing = await findEntityByTitle(entityType, title, { semanticFallback: false });
        if (existing) {
            context.set('error', `${entityType} "${title}" already exists.`);
            return this.result(ALREADY_EXISTS, `${entityType} "${title}" already exists.`);
        }

        const content = (context.get('content') as string) ?? '';

        const dir = await ensureEntityDir(entityType);
        const entityMeta = createEntityMeta(entityType, title);
        const id = entityMeta.id;
        const filepath = getPlatform().paths.join(dir, entityFilename(title, id));

        const meta: Record<string, unknown> = { ...entityMeta };

        // Merge extra fields from context into metadata
        if (extraFieldsStr) {
            for (const field of extraFieldsStr.split(',').map(f => f.trim()).filter(Boolean)) {
                const val = context.get(field);
                if (val !== undefined) {
                    meta[field] = val;
                }
            }
        }

        // Validate fields against entity type schema
        const typeConfig = await getEntityType(entityType);
        if (typeConfig) {
            // Auto-populate required fields that have defaults or can be inferred
            for (const field of typeConfig.fields) {
                const val = meta[field.key];
                // A required "name" field defaults to the entity title
                if (val === undefined && field.required && field.key === 'name' && field.type === 'string') {
                    meta[field.key] = title;
                    continue;
                }
                // For enum fields, if the value isn't valid for this type, fall back to default
                if (field.type === 'enum' && field.values?.length && val !== undefined) {
                    if (!field.values.includes(val as string) && field.default !== undefined) {
                        meta[field.key] = field.default;
                        continue;
                    }
                }
                // Apply defaults for missing required fields
                if (val === undefined && field.required && field.default !== undefined) {
                    meta[field.key] = field.default;
                }
                // Infer missing required string fields from body content
                if (val === undefined && field.required && field.type === 'string' && content) {
                    // Try to extract from body — look for "is a/an {value}"
                    const bodyMatch = content.match(new RegExp(`is (?:a |an )?([\\w]+)`, 'i'));
                    if (bodyMatch) {
                        meta[field.key] = bodyMatch[1].toLowerCase();
                    }
                }
            }

            const errors = validateEntity(meta, typeConfig, true);
            if (errors.length > 0) {
                const msg = `Validation failed for ${entityType}: ${formatValidationErrors(errors)}`;
                context.set('error', msg);
                return this.result(ResultStatus.ERROR, msg);
            }
        }

        await writeEntity(filepath, meta, content);

        // Generate and persist summary
        const summary = await generateEntitySummary(entityType, title, content, meta);
        meta.summary = summary;
        await writeEntity(filepath, meta, content);

        context.set('filepath', filepath);
        context.set('entity', { filepath, content, ...meta });

        // Accumulate into created_entities array so multi-create processes
        // expose ALL results to the completion checker (not just the last one)
        const created = (context.get('created_entities') as unknown[] | undefined) ?? [];
        created.push({ id, title, entityType, filepath });
        context.set('created_entities', created);

        // Update entity index incrementally
        const index = getEntityIndex();
        if (index.isBuilt) {
            await index.addOrUpdate(entityType, id, title, filepath, summary);
        }

        // Update embedding index
        const embeddingIndex = getEmbeddingIndex();
        if (embeddingIndex.isLoaded) {
            await embeddingIndex.upsert(`${entityType}:${id}`, { title, summary: summary ?? '', bodySnippet: content.slice(0, 500) });
        }

        // Record in analytics (fire-and-forget)
        import('../../../analytics/analytics-service.js')
            .then(({ getAnalyticsService }) => getAnalyticsService().recordEntityCreated(entityType))
            .catch(() => {});

        return this.result(ResultStatus.OK, `Created ${entityType} "${title}" at ${filepath}.`);
    }
}
