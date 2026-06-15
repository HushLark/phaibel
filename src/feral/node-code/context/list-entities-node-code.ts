// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — List Entities NodeCode
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { listEntities, type EntityTypeName } from '../../../entities/entity.js';

export class ListEntitiesNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'entity_type', name: 'Entity Type', description: 'The entity type to list (any configured entity type, e.g. task, note, event, goal).', type: 'string' },
        { key: 'context_path', name: 'Context Path', description: 'Context key to store the entity list.', type: 'string', default: 'entities' },
        { key: 'max_results', name: 'Max Results', description: 'Maximum number of entities to return. Default 50. Use a lower value for large vaults or listing queries.', type: 'int', isOptional: true },
        { key: 'highlights_days', name: 'Highlights Window (days)', description: 'If set, return only entities whose primary date field falls within this many days from today (e.g. 7 for next week). Entities with no date field are always included. Use for calendar-style "what\'s coming up" queries.', type: 'int', isOptional: true },
        { key: 'include_content', name: 'Include Body Content', description: 'Set to true to include the full markdown body of each entity. Default false — meta fields only. Only needed when the user asks to read or summarise entity bodies.', type: 'boolean', isOptional: true },
    ];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Entities listed successfully.' },
        { status: ResultStatus.ERROR, description: 'Failed to list entities.' },
    ];

    constructor() {
        super('list_entities', 'List Entities', 'Lists all entities of a given type in the active project. Returns metadata fields only by default (no body content) to stay within model context limits. Use highlights_days to restrict to upcoming items.', NodeCodeCategory.DATA);
    }

    async process(context: Context): Promise<Result> {
        const entityType = this.getRequiredConfigValue('entity_type') as EntityTypeName;
        const contextPath = this.getRequiredConfigValue('context_path', 'entities') as string;

        const maxResults = (this.getOptionalConfigValue('max_results') as number | null) ?? 50;
        const highlightsDays = this.getOptionalConfigValue('highlights_days') as number | null;
        const includeContent = (this.getOptionalConfigValue('include_content') as boolean | null) ?? false;

        try {
            let entities = await listEntities(entityType);

            // Apply date window filter if requested (for "what's happening this week" style queries)
            if (highlightsDays != null && highlightsDays > 0) {
                const now = Date.now();
                const windowEnd = now + highlightsDays * 24 * 60 * 60 * 1000;
                entities = entities.filter(e => {
                    // Find any date-like field in meta
                    const dateVal = Object.values(e.meta).find(
                        v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v as string)
                    ) as string | undefined;
                    if (!dateVal) return true; // no date → always include
                    const ts = new Date(dateVal).getTime();
                    return ts >= now - 24 * 60 * 60 * 1000 && ts <= windowEnd; // include today + window
                });
            }

            const totalCount = entities.length;
            const sliced = entities.slice(0, maxResults);

            const result = sliced.map(e => {
                const item: Record<string, unknown> = { ...e.meta };
                if (includeContent) item.content = e.content;
                return item;
            });

            context.set(contextPath, result);
            const note = totalCount > maxResults ? ` (showing ${maxResults} of ${totalCount} total)` : '';
            return this.result(ResultStatus.OK, `Listed ${result.length} ${entityType}(s)${note}.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            context.set('error', message);
            return this.result(ResultStatus.ERROR, `Failed to list ${entityType}: ${message}`);
        }
    }
}
