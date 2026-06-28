// ─────────────────────────────────────────────────────────────────────────────
// Pipeline NodeCode — Gather Context (action path)
// ─────────────────────────────────────────────────────────────────────────────
//
// Fetches entity context for the action pipeline (Phases 1-3 in the original
// design doc).  Stores the serialized context string so downstream NodeCodes
// (select_nodes, action_loop) can include it in LLM prompts.
//
// Reads: __classification, __request_weights, __entity_index, __entity_types,
//        __on_status
// Writes: __gathered_context (GatheredContext), __gathered_context_str (string)
// Result: ok (always — partial context is still usable)
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { fetchContextByClassification, serializeGatheredContext } from '../../../context/context-loop.js';
import { buildContextManifest } from '../../../context/context-manifest.js';
import { buildMomentContext } from '../../../context/moment.js';
import { debug } from '../../../utils/debug.js';
import type { ClassificationResult } from '../../../context/request-classifier.js';
import type { RequestWeights } from '../../../context/request-weights.js';
import type { EntityIndex } from '../../../entities/entity-index.js';
import type { EntityTypeConfig } from '../../../entities/entity-type-config.js';

export class PipelineGatherContextNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Context gathered (may be empty if vault has no matching entities).' },
    ];

    constructor() {
        super(
            'pipeline_gather_context',
            'Pipeline: Gather Context',
            'Fetches relevant entity context for the action pipeline and stores it for node selection and process design.',
            'pipeline',
        );
    }

    async process(context: Context): Promise<Result> {
        const onStatus = context.get('__on_status') as ((s: string) => void) | null;
        const classification = context.get('__classification') as ClassificationResult | null;
        const requestWeights = context.get('__request_weights') as RequestWeights | null;
        const entityIndex = context.get('__entity_index') as EntityIndex | null;
        const entityTypes = (context.get('__entity_types') as EntityTypeConfig[] | null) ?? [];
        const sourceScope = context.get('__source_scope') as { id: string; name: string } | null;

        if (!classification || !requestWeights || !entityIndex) {
            // Store empty context so downstream NodeCodes still function
            context.set('__gathered_context', { nodes: [], rounds: 0, summary: 'No context available' });
            context.set('__gathered_context_str', '');
            return this.result(ResultStatus.OK, 'Skipped: missing classification or entity index.');
        }

        onStatus?.(sourceScope ? `Searching ${sourceScope.name}…` : 'Gathering context…');

        try {
            const moment = buildMomentContext();
            const manifest = buildContextManifest(entityIndex, entityTypes, moment,
                (context.get('__intent') as { entityTypes?: string[] } | null)?.entityTypes ?? []);
            void manifest; // for tracing if needed later

            const gathered = await fetchContextByClassification(
                classification, requestWeights, entityIndex, entityTypes, 20, sourceScope?.id,
            );
            const gatheredStr = serializeGatheredContext(gathered);

            context.set('__gathered_context', gathered);
            context.set('__gathered_context_str', gatheredStr);

            debug('pipeline', `Gathered: ${gathered.nodes.length} entities in ${gathered.rounds} round(s)`);
            return this.result(ResultStatus.OK, `Gathered ${gathered.nodes.length} entities.`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            debug('pipeline', `Gather context failed: ${msg} — continuing with empty context`);
            context.set('__gathered_context', { nodes: [], rounds: 0, summary: 'Context fetch failed' });
            context.set('__gathered_context_str', '');
            return this.result(ResultStatus.OK, `Context fetch failed (${msg}); continuing with empty context.`);
        }
    }
}
