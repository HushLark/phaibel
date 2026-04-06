// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Link Entities NodeCode
// ─────────────────────────────────────────────────────────────────────────────
//
// Adds a labeled link from one entity to another by appending to the
// frontmatter `links` array:  [{ target: "type:id", label: "..." }]
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { findEntityByTitle, writeEntity, type EntityTypeName } from '../../../entities/entity.js';

const NOT_FOUND = 'not_found';

export class LinkEntitiesNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'source_entity_type', name: 'Source Entity Type', description: 'Entity type of the source (from) entity.', type: 'string' },
        { key: 'source_entity_title', name: 'Source Entity Title', description: 'Title of the source entity. Supports {context_key} interpolation.', type: 'string' },
        { key: 'target_entity_type', name: 'Target Entity Type', description: 'Entity type of the target (to) entity.', type: 'string' },
        { key: 'target_entity_title', name: 'Target Entity Title', description: 'Title of the target entity. Supports {context_key} interpolation.', type: 'string' },
        { key: 'label', name: 'Link Label', description: 'Relationship label (e.g. "blocks", "relates-to", "parent-of"). Supports {context_key} interpolation.', type: 'string' },
    ];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Link added successfully.' },
        { status: NOT_FOUND, description: 'Source or target entity not found.' },
        { status: ResultStatus.ERROR, description: 'Failed to link entities.' },
    ];

    constructor() {
        super('link_entities', 'Link Entities', 'Adds a labeled link from one entity to another in frontmatter.', NodeCodeCategory.DATA);
    }

    async process(context: Context): Promise<Result> {
        const sourceType = this.getRequiredConfigValue('source_entity_type') as EntityTypeName;
        const rawSourceTitle = this.getRequiredConfigValue('source_entity_title') as string;
        const targetType = this.getRequiredConfigValue('target_entity_type') as EntityTypeName;
        const rawTargetTitle = this.getRequiredConfigValue('target_entity_title') as string;
        const rawLabel = this.getRequiredConfigValue('label') as string;

        const sourceTitle = this.interpolate(rawSourceTitle, context);
        const targetTitle = this.interpolate(rawTargetTitle, context);
        const label = this.interpolate(rawLabel, context);

        // Find both entities
        const source = await findEntityByTitle(sourceType, sourceTitle);
        if (!source) {
            context.set('error', `Source ${sourceType} "${sourceTitle}" not found.`);
            return this.result(NOT_FOUND, `Source ${sourceType} "${sourceTitle}" not found.`);
        }

        const target = await findEntityByTitle(targetType, targetTitle);
        if (!target) {
            context.set('error', `Target ${targetType} "${targetTitle}" not found.`);
            return this.result(NOT_FOUND, `Target ${targetType} "${targetTitle}" not found.`);
        }

        // Build the link target key: "type:id"
        const targetId = target.meta.id as string;
        const linkTarget = `${targetType}:${targetId}`;

        // Append to existing links array (avoid duplicates)
        const existingLinks = Array.isArray(source.meta.links) ? source.meta.links as Array<{ target: string; label: string }> : [];
        const alreadyLinked = existingLinks.some(l => l.target === linkTarget && l.label === label);

        if (!alreadyLinked) {
            existingLinks.push({ target: linkTarget, label });
            source.meta.links = existingLinks;
            await writeEntity(source.filepath, source.meta, source.content);
        }

        context.set('link', { source: `${sourceType}:${source.meta.id}`, target: linkTarget, label });
        return this.result(ResultStatus.OK, `Linked ${sourceType} "${sourceTitle}" → ${targetType} "${targetTitle}" (${label}).`);
    }
}
