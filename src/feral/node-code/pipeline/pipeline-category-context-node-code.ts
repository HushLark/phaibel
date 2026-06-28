// ─────────────────────────────────────────────────────────────────────────────
// Pipeline NodeCode — Category Context
// ─────────────────────────────────────────────────────────────────────────────
//
// Fast-dispatch for known query categories (query, analytical, introspection).
// Fetches entity context from the vault index and stores results for synthesis.
//
// Reads: __classification, __request_weights, __entity_index, __entity_types,
//        __on_status, __intent
// Writes: __all_results, __all_reasonings, __process_source, __process_key
// Result: ok | error (both route to synthesize)
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { fetchContextByClassification, serializeGatheredContext } from '../../../context/context-loop.js';
import { CATEGORY_PROCESS_KEY } from '../../processes/category-processes.js';
import { debug } from '../../../utils/debug.js';
import { scrubSecrets } from '../../../commands/chat-helpers.js';
import type { ClassificationResult } from '../../../context/request-classifier.js';
import type { RequestWeights } from '../../../context/request-weights.js';
import type { EntityIndex } from '../../../entities/entity-index.js';
import type { EntityTypeConfig } from '../../../entities/entity-type-config.js';

export class PipelineCategoryContextNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK,    description: 'Context fetched; results in __all_results.' },
        { status: ResultStatus.ERROR, description: 'Context fetch failed.' },
    ];

    constructor() {
        super(
            'pipeline_category_context',
            'Pipeline: Category Context',
            'Fetches vault context for a known query category (query/analytical/introspection) and stores results for synthesis.',
            'pipeline',
        );
    }

    async process(context: Context): Promise<Result> {
        const onStatus = context.get('__on_status') as ((s: string) => void) | null;
        const classification = context.get('__classification') as ClassificationResult | null;
        const requestWeights = context.get('__request_weights') as RequestWeights | null;
        const entityIndex = context.get('__entity_index') as EntityIndex | null;
        const entityTypes = (context.get('__entity_types') as EntityTypeConfig[] | null) ?? [];

        if (!classification || !requestWeights || !entityIndex) {
            return this.result(ResultStatus.ERROR, 'Missing classification, request_weights, or entity_index in context.');
        }

        const prebuiltKey = CATEGORY_PROCESS_KEY[classification.category];
        onStatus?.('Gathering information…');
        context.set('__process_source', 'category');
        context.set('__process_key', prebuiltKey ?? `phaibel.${classification.category}`);

        // When scoped to a named CF/x3 connection, restrict context to that source.
        const sourceScope = context.get('__source_scope') as { id: string; name: string } | null;

        try {
            const gathered = await fetchContextByClassification(
                classification, requestWeights, entityIndex, entityTypes, 20, sourceScope?.id,
            );
            // Expose the gathered nodes so synthesis can attribute facts to their source.
            context.set('__gathered_context', gathered);
            const contextResult: Record<string, unknown> = {
                gathered_context: serializeGatheredContext(gathered),
            };

            // Introspection questions ("what am I connected to?", "what calendars
            // do I have?") need system state, not vault entities — the entity fetch
            // alone can't see calendar feeds or CF/x3 sources. Load a compact,
            // secret-free snapshot so synthesis can answer accurately. Also trigger
            // on connection keywords in case the request is classified as a query.
            const lcInput = (context.getString('user_input') ?? '').toLowerCase();
            const connectionIntent = /\b(connect|connected|connection|integration|integrations|calendar|calendars|ics|cfx3|cf\/x3|federat\w*|source|sources|provider|providers)\b/.test(lcInput);
            if (classification.category === 'introspection' || connectionIntent) {
                try {
                    const { IntrospectionService } = await import('../../../introspection/introspection-service.js');
                    const svc = new IntrospectionService();
                    const [calendars, cfx3Connections, providers] = await Promise.all([
                        svc.getCalendars(),
                        svc.getCfx3Connections(),
                        svc.getProviders(),
                    ]);
                    contextResult.system_introspection = {
                        calendars,
                        cfx3_connections: cfx3Connections,
                        ai_providers: providers.providers,
                    };
                } catch (e) {
                    debug('pipeline', `Introspection snapshot failed: ${e instanceof Error ? e.message : String(e)}`);
                }
            }

            const scrubbedResult = scrubSecrets(contextResult) as Record<string, unknown>;

            context.set('__all_results', [scrubbedResult]);
            context.set('__all_reasonings', [`Category: ${classification.category} — ${classification.summary}`]);

            debug('pipeline', `Category context fetched: ${gathered.nodes.length} entities`);
            return this.result(ResultStatus.OK, `Category context fetched.`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            debug('pipeline', `Category context failed: ${msg}`);
            context.set('__all_results', [{ _error: msg }]);
            context.set('__all_reasonings', [`Category: ${classification.category} — context fetch failed`]);
            return this.result(ResultStatus.ERROR, msg);
        }
    }
}
