// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Search Entities NodeCode
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { searchEntities, type EntityTypeName } from '../../../entities/entity.js';

const NOT_FOUND = 'not_found';

export class SearchEntitiesNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'entity_type', name: 'Entity Type', description: 'The entity type to search (optional — omit to search all types).', type: 'string', isOptional: true },
        { key: 'query', name: 'Query', description: 'Search query string. Supports {context_key} interpolation.', type: 'string', isOptional: true },
        { key: 'context_path', name: 'Context Path', description: 'Context key to store search results.', type: 'string', default: 'entities' },
    ];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Entities found matching query.' },
        { status: NOT_FOUND, description: 'No entities matched the query.' },
        { status: ResultStatus.ERROR, description: 'Failed to search entities.' },
    ];

    /** Accept extra config keys (e.g. LLM putting "query" directly in config) */
    get allowExtraConfig(): boolean { return true; }

    constructor() {
        super('search_entities', 'Search Entities', 'Full-text and semantic search across entity titles, summaries, and body content. Returns results scored by relevance.', NodeCodeCategory.DATA);
    }

    async process(context: Context): Promise<Result> {
        const entityType = this.getOptionalConfigValue('entity_type') as EntityTypeName | null;
        const contextPath = this.getRequiredConfigValue('context_path', 'entities') as string;

        // Resolve query from config (with interpolation), then context fallbacks
        let query = this.getOptionalConfigValue('query') as string | null;
        if (query) {
            query = this.interpolate(query, context);
        } else {
            // Fallback chain: context 'query' → context 'user_input' (from chat pipeline)
            query = (context.get('query') as string | null)
                 ?? (context.get('user_input') as string | null);
        }

        if (!query) {
            context.set('error', 'No search query provided.');
            return this.result(ResultStatus.ERROR, 'No search query provided.');
        }

        try {
            const matches = await searchEntities(query, entityType ?? undefined);

            if (matches.length === 0) {
                context.set('error', `No entities found matching "${query}".`);
                return this.result(NOT_FOUND, `No entities matched "${query}".`);
            }

            const result = matches.map(e => ({
                title: e.meta.title as string,
                filepath: e.filepath,
                content: e.content,
                score: e.score,
                ...e.meta,
            }));

            context.set(contextPath, result);
            return this.result(ResultStatus.OK, `Found ${result.length} entit${result.length === 1 ? 'y' : 'ies'} matching "${query}".`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            context.set('error', message);
            return this.result(ResultStatus.ERROR, `Search failed: ${message}`);
        }
    }
}
