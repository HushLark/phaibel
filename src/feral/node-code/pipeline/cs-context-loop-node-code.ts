// ─────────────────────────────────────────────────────────────────────────────
// Cruel Summer Pipeline — Step 2: Get Context (iterative)
// ─────────────────────────────────────────────────────────────────────────────
//
// Fetches entity context using the search params from cs_categorize, then
// enters a validation loop: the LLM reviews the gathered entities and may
// request additions or removals until satisfied or until MAX_LOOPS is reached.
//
// The inner loop handles refinement; the outer retry (cs_evaluate → cs_categorize)
// re-runs this step from scratch on full pipeline retries.
//
// Reads: user_input, __cs_context_search_params, __cs_request_type,
//        __classification, __request_weights, __entity_index, __entity_types,
//        __on_status
// Writes: __gathered_context, __gathered_context_str
// Result: ok (always — partial or empty context is still usable), error
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { fetchContextByClassification, serializeGatheredContext } from '../../../context/context-loop.js';
import type { GatheredContext } from '../../../context/context-loop.js';
import { getModelForCapability } from '../../../llm/router.js';
import { parseJsonResponse } from '../../../utils/json-parser.js';
import { debug } from '../../../utils/debug.js';
import type { ClassificationResult } from '../../../context/request-classifier.js';
import type { RequestWeights } from '../../../context/request-weights.js';
import type { EntityIndex } from '../../../entities/entity-index.js';
import type { EntityTypeConfig } from '../../../entities/entity-type-config.js';

const MAX_LOOPS = 5;

export class CSContextLoopNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK,    description: 'Context gathered and validated (may be partial).' },
        { status: ResultStatus.ERROR, description: 'Unrecoverable error — entity index unavailable.' },
    ];

    constructor() {
        super(
            'cs_context_loop',
            'CS: Get Context (loop)',
            'Iteratively gathers and LLM-validates entity context. Max 5 inner loops. Step 2 of Cruel Summer.',
            'pipeline',
        );
    }

    async process(context: Context): Promise<Result> {
        const userInput = context.getString('user_input') ?? '';
        const searchParams = (context.get('__cs_context_search_params') as string[] | null) ?? [userInput];
        const requestType = context.getString('__cs_request_type') ?? 'action';
        const onStatus = context.get('__on_status') as ((s: string) => void) | null;

        const classification = context.get('__classification') as ClassificationResult | null;
        const requestWeights = context.get('__request_weights') as RequestWeights | null;
        const entityIndex = context.get('__entity_index') as EntityIndex | null;
        const entityTypes = (context.get('__entity_types') as EntityTypeConfig[] | null) ?? [];

        if (!entityIndex || !classification || !requestWeights) {
            context.set('__gathered_context', { nodes: [], rounds: 0, summary: '' });
            context.set('__gathered_context_str', '');
            return this.result(ResultStatus.OK, 'Skipped: missing entity index or classification.');
        }

        onStatus?.('Gathering context…');

        // Initial fetch using the search params as the summary signal
        const syntheticClass: ClassificationResult = {
            ...classification,
            summary: searchParams.join(' '),
        };
        let gathered: GatheredContext = await fetchContextByClassification(
            syntheticClass, requestWeights, entityIndex, entityTypes,
        );

        debug('pipeline', `CS context-loop initial: ${gathered.nodes.length} entities`);

        const categorizeLlm = await getModelForCapability('categorize');

        // Track state across rounds to prevent redundant work
        const attemptedSearches = new Set<string>(searchParams.map(s => s.toLowerCase()));
        const permanentlyRemovedTitles = new Set<string>(); // never re-add these

        for (let i = 0; i < MAX_LOOPS; i++) {
            const gatheredStr = serializeGatheredContext(gathered);
            onStatus?.(`Validating context${i > 0 ? ` (round ${i + 1})` : ''}…`);

            const alreadyTriedBlock = attemptedSearches.size > 0
                ? `\nALREADY SEARCHED (do not repeat these): ${Array.from(attemptedSearches).join(', ')}\n`
                : '';

            let verdict: { verdict: 'good' | 'refine'; add_searches?: string[]; remove_entity_titles?: string[] };

            try {
                const raw = await categorizeLlm.chat(
                    [{
                        role: 'user' as const,
                        content: `Evaluate the context gathered for this request.

USER REQUEST: "${userInput}"
REQUEST TYPE: ${requestType}
CONTEXT FOCUS: ${searchParams.join(', ')}
${alreadyTriedBlock}
GATHERED CONTEXT:
${gatheredStr || '(empty — no entities found yet)'}

Does this context contain what is needed to fulfil the request?
- Assess whether the key people, tasks, events, or data are present.
- Only suggest new searches not already in ALREADY SEARCHED above.
- If something specific is clearly needed but missing, name a NEW search term.
- If any gathered entity is obviously wrong or irrelevant, name it for removal.
- If searches have been exhausted and nothing better can be found, say "good".

Return JSON only:
{
  "verdict": "good" | "refine",
  "reasoning": "One sentence",
  "add_searches": ["new search term not yet tried"],
  "remove_entity_titles": ["exact title of wrong entity"]
}`,
                    }],
                    {
                        systemPrompt: 'You are a context quality checker. Say "good" if context is sufficient or if further searching is unlikely to help. Only say "refine" when you have a NEW search that has not been tried yet.',
                        temperature: 0.2,
                    },
                );

                verdict = parseJsonResponse(raw) as typeof verdict;
            } catch (err) {
                debug('pipeline', `CS context-loop validation failed at round ${i}: ${err}`);
                break;
            }

            debug('pipeline', `CS context-loop round ${i + 1}: verdict=${verdict.verdict}`);

            if (verdict.verdict === 'good') break;

            // Remove wrong entities and remember them permanently
            const removeTitles = verdict.remove_entity_titles ?? [];
            if (removeTitles.length > 0) {
                for (const t of removeTitles) permanentlyRemovedTitles.add(t.toLowerCase());
                gathered = {
                    ...gathered,
                    nodes: (gathered.nodes as Array<{ id: string; title?: string }>).filter(
                        n => !permanentlyRemovedTitles.has((n.title ?? '').toLowerCase()),
                    ) as GatheredContext['nodes'],
                };
                debug('pipeline', `CS context-loop removed ${removeTitles.length} wrong entities (${permanentlyRemovedTitles.size} total blacklisted)`);
            }

            // Fetch additional context — only for queries not already attempted
            const newSearches = (verdict.add_searches ?? []).filter(
                q => !attemptedSearches.has(q.toLowerCase()),
            );
            for (const query of newSearches) {
                attemptedSearches.add(query.toLowerCase());
                try {
                    const extraClass: ClassificationResult = { ...classification, summary: query };
                    const extra = await fetchContextByClassification(extraClass, requestWeights, entityIndex, entityTypes);
                    const existingIds = new Set((gathered.nodes as Array<{ id: string }>).map(n => n.id));
                    let added = 0;
                    for (const node of extra.nodes as Array<{ id: string; title?: string }>) {
                        // Never re-add entities the LLM has already rejected
                        if (permanentlyRemovedTitles.has((node.title ?? '').toLowerCase())) continue;
                        if (!existingIds.has(node.id)) {
                            (gathered.nodes as Array<{ id: string }>).push(node);
                            existingIds.add(node.id);
                            added++;
                        }
                    }
                    debug('pipeline', `CS context-loop added ${added} entities for query: "${query}"`);
                } catch (err) {
                    debug('pipeline', `CS context-loop extra fetch failed: ${err}`);
                }
            }

            // If the LLM only suggested searches we've already tried, it's stuck — stop early
            const allSearchesAlreadyTried = (verdict.add_searches ?? []).length > 0 &&
                newSearches.length === 0;
            if (allSearchesAlreadyTried && removeTitles.length === 0) {
                debug('pipeline', 'CS context-loop: all suggested searches already attempted — stopping early');
                break;
            }
        }

        const finalStr = serializeGatheredContext(gathered);
        context.set('__gathered_context', gathered);
        context.set('__gathered_context_str', finalStr);

        debug('pipeline', `CS context-loop final: ${(gathered.nodes as unknown[]).length} entities`);
        return this.result(ResultStatus.OK, `Context gathered: ${(gathered.nodes as unknown[]).length} entities.`);
    }
}
