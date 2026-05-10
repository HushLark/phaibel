// ─────────────────────────────────────────────────────────────────────────────
// Query Relevance Filter — Deterministic catalog node pre-filter
//
// Extracts keywords from the user's query, searches the entity index, and
// returns which entity types are relevant. This lets us send only relevant
// catalog nodes to the LLM, dramatically reducing token count.
//
// At scale (1M+ context nodes), sending all ~220 catalog nodes per entity type
// wastes tokens on types the user didn't mention. This filter is sub-millisecond
// and runs before any LLM call.
// ─────────────────────────────────────────────────────────────────────────────

import type { EntityTypeConfig } from '../entities/entity-type-config.js';
import type { EntityIndex } from '../entities/entity-index.js';
import type { CatalogNode } from '../feral/catalog/catalog-node.js';
import { getEmbeddingIndex } from '../entities/embedding-index.js';

// English stop words — common words that don't carry entity-matching signal
const STOP_WORDS = new Set([
    'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your',
    'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her',
    'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs',
    'themselves', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
    'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
    'having', 'do', 'does', 'did', 'doing', 'a', 'an', 'the', 'and', 'but', 'if',
    'or', 'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with',
    'about', 'against', 'between', 'through', 'during', 'before', 'after', 'above',
    'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under',
    'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
    'how', 'all', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
    'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's',
    't', 'can', 'will', 'just', 'don', 'should', 'now', 'd', 'll', 'm', 'o', 're',
    've', 'y', 'ain', 'aren', 'couldn', 'didn', 'doesn', 'hadn', 'hasn', 'haven',
    'isn', 'ma', 'mightn', 'mustn', 'needn', 'shan', 'shouldn', 'wasn', 'weren',
    'won', 'wouldn', 'could', 'would', 'might', 'must', 'shall', 'need',
    // Common verbs that don't help entity matching
    'want', 'know', 'think', 'make', 'go', 'get', 'take', 'come', 'see', 'look',
    'give', 'tell', 'say', 'help', 'let', 'try', 'keep', 'put', 'set', 'show',
    'add', 'create', 'update', 'delete', 'remove', 'change', 'mark', 'find',
    'list', 'search', 'check', 'remember', 'save', 'track', 'also', 'please',
    'like', 'new', 'today', 'tomorrow', 'yesterday', 'next', 'last', 'first',
    'really', 'something', 'thing', 'things', 'stuff', 'much', 'many', 'well',
]);

// Action words that signal specific entity operations (not removed as stop words
// but used to boost entity types that match the action)
const ACTION_TYPE_HINTS: Record<string, string[]> = {
    'appointment': ['event'],
    'meeting': ['event'],
    'schedule': ['event'],
    'calendar': ['event'],
    'deadline': ['task', 'event'],
    'todo': ['task'],
    'done': ['task'],
    'complete': ['task'],
    'finish': ['task'],
    'buy': ['task'],
    'call': ['task', 'person'],
    'email': ['task', 'person'],
    'contact': ['person'],
    'meet': ['person', 'event'],
    'goal': ['goal'],
    'achieve': ['goal'],
    'objective': ['goal'],
    'idea': ['note'],
    'note': ['note'],
    'remember': ['note'],
    'password': ['note'],
    'recipe': ['note'],
    'stop': ['todont'],
    'quit': ['todont'],
    'avoid': ['todont'],
    'never': ['todont'],
    'recurring': ['recurrence'],
    'repeat': ['recurrence'],
    'every': ['recurrence'],
    'daily': ['recurrence'],
    'weekly': ['recurrence'],
    'monthly': ['recurrence'],
};

export interface RelevanceResult {
    /** Keywords extracted from the user's query (stop words removed) */
    keywords: string[];
    /** Entity types that are relevant, with match details */
    relevantTypes: RelevantType[];
    /** Entity types mentioned by name in the query */
    mentionedTypes: string[];
    /** Compact summary for the LLM (e.g. "Bob → person:1, game:1") */
    relevanceHint: string;
    /** Number of catalog nodes that can be skipped */
    filteredNodeCount: number;
    /** Total catalog nodes before filtering */
    totalNodeCount: number;
}

export interface RelevantType {
    type: string;
    /** Why this type is relevant */
    reason: 'mentioned' | 'entity_match' | 'action_hint' | 'always';
    /** Number of matching entities (0 if type match only) */
    matchCount: number;
    /** Sample entity titles that matched */
    matchSamples: string[];
}

/**
 * Extract keywords from user input after removing stop words.
 */
export function extractKeywords(input: string): string[] {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9\s'-]/g, ' ')  // keep alphanumeric, spaces, hyphens, apostrophes
        .split(/\s+/)
        .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

/**
 * Determine which entity types are relevant to the user's query.
 * Uses a deterministic (no LLM) approach:
 * 1. Extract keywords from query
 * 2. Check if any keywords match entity type names/plurals
 * 3. Search entity index for keyword matches, group by type
 * 4. Check action words for type hints
 * 5. Use vector similarity (local embeddings) to surface types with relevance config
 */
export async function analyzeQueryRelevance(
    userInput: string,
    entityTypes: EntityTypeConfig[],
    entityIndex: EntityIndex,
): Promise<RelevanceResult> {
    const keywords = extractKeywords(userInput);
    const inputLower = userInput.toLowerCase();

    const typeMap = new Map<string, RelevantType>();

    // Always-relevant types (system nodes, generic operations)
    // These don't generate per-type catalog nodes, so no filtering needed

    // 1. Check direct entity type mentions
    const mentionedTypes: string[] = [];
    for (const et of entityTypes) {
        if (inputLower.includes(et.name) || inputLower.includes(et.plural)) {
            mentionedTypes.push(et.name);
            typeMap.set(et.name, {
                type: et.name,
                reason: 'mentioned',
                matchCount: 0,
                matchSamples: [],
            });
        }
    }

    // 2. Search entity index for each keyword
    const matchesByType = new Map<string, { count: number; samples: string[] }>();

    for (const keyword of keywords) {
        if (!entityIndex.isBuilt) break;
        const results = entityIndex.search(keyword);
        for (const result of results) {
            const type = result.node.type;
            const existing = matchesByType.get(type) ?? { count: 0, samples: [] };
            existing.count++;
            if (existing.samples.length < 3 && !existing.samples.includes(result.node.title)) {
                existing.samples.push(result.node.title);
            }
            matchesByType.set(type, existing);
        }
    }

    for (const [type, matches] of matchesByType) {
        if (!typeMap.has(type)) {
            typeMap.set(type, {
                type,
                reason: 'entity_match',
                matchCount: matches.count,
                matchSamples: matches.samples,
            });
        } else {
            const existing = typeMap.get(type)!;
            existing.matchCount = matches.count;
            existing.matchSamples = matches.samples;
        }
    }

    // 3. Check action word hints
    for (const keyword of keywords) {
        const hints = ACTION_TYPE_HINTS[keyword];
        if (hints) {
            for (const type of hints) {
                if (entityTypes.some(et => et.name === type) && !typeMap.has(type)) {
                    typeMap.set(type, {
                        type,
                        reason: 'action_hint',
                        matchCount: 0,
                        matchSamples: [],
                    });
                }
            }
        }
    }

    // 4. Vector similarity — surface types with RelevanceConfig whose entities
    //    score semantically close to the query, even without keyword overlap
    const embeddingIndex = getEmbeddingIndex();
    if (embeddingIndex.isLoaded && userInput.trim()) {
        try {
            const vectorResults = await embeddingIndex.search(userInput, 20);
            for (const result of vectorResults) {
                const [type] = result.key.split(':');
                if (!typeMap.has(type) && entityTypes.some(et => et.name === type)) {
                    typeMap.set(type, {
                        type,
                        reason: 'entity_match',
                        matchCount: 1,
                        matchSamples: [],
                    });
                }
            }
        } catch {
            // Embeddings not available — skip vector signal
        }
    }

    // If no types matched at all, include all types (can't safely filter)
    const relevantTypes = Array.from(typeMap.values());
    if (relevantTypes.length === 0) {
        for (const et of entityTypes) {
            relevantTypes.push({
                type: et.name,
                reason: 'always',
                matchCount: 0,
                matchSamples: [],
            });
        }
    }

    // Build compact relevance hint for the LLM
    const hintParts: string[] = [];
    for (const keyword of keywords) {
        const typeCounts: string[] = [];
        for (const [type, matches] of matchesByType) {
            const kwMatches = entityIndex.search(keyword)
                .filter(r => r.node.type === type);
            if (kwMatches.length > 0) {
                typeCounts.push(`${type}:${kwMatches.length}`);
            }
        }
        if (typeCounts.length > 0) {
            hintParts.push(`"${keyword}" → ${typeCounts.join(', ')}`);
        }
    }

    return {
        keywords,
        relevantTypes,
        mentionedTypes,
        relevanceHint: hintParts.length > 0 ? hintParts.join('\n') : '',
        filteredNodeCount: 0,  // will be set by the caller
        totalNodeCount: 0,     // will be set by the caller
    };
}

/**
 * Filter catalog nodes to only include those relevant to the query.
 * Keeps all non-entity nodes (system, flow, genai, etc.) and only
 * filters entity-type-specific nodes based on relevance.
 */
export function filterCatalogNodes(
    allNodes: CatalogNode[],
    relevantTypes: RelevantType[],
    entityTypes: EntityTypeConfig[],
): CatalogNode[] {
    const relevantTypeNames = new Set(relevantTypes.map(rt => rt.type));
    const allTypeNames = new Set(entityTypes.map(et => et.name));
    const allTypePlurals = new Map(entityTypes.map(et => [et.plural, et.name]));

    return allNodes.filter(node => {
        // Always keep non-entity nodes
        if (node.group !== 'entity') return true;

        // Always keep generic entity nodes (not type-specific)
        const key = node.key;
        if (
            key === 'search_all_entities' ||
            key === 'create_content_type' ||
            key === 'update_content_type' ||
            key === 'link_entities' ||
            key === 'create_recurring_task' ||
            key.startsWith('import_')
        ) {
            return true;
        }

        // Determine which entity type this node belongs to
        // Pattern: {action}_{type} or {action}_{plural} or set_{type}_{field}
        for (const et of entityTypes) {
            if (
                key === `list_${et.plural}` ||
                key === `search_${et.plural}` ||
                key === `find_${et.name}` ||
                key === `create_${et.name}` ||
                key === `update_${et.name}` ||
                key === `delete_${et.name}` ||
                key === `complete_${et.name}` ||
                key === `sort_${et.plural}` ||
                key === `load_vault_context_${et.name}` ||
                key === `review_${et.name}` ||
                key === `questions_${et.name}` ||
                key === `add_tag_${et.name}` ||
                key.startsWith(`set_${et.name}_`)
            ) {
                return relevantTypeNames.has(et.name);
            }
        }

        // Unknown entity node — keep it to be safe
        return true;
    });
}
