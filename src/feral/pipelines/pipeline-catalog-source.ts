// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Catalog Source
// ─────────────────────────────────────────────────────────────────────────────
//
// Registers the catalog nodes used by pipeline processes.  Each node maps a
// well-known key to the corresponding pipeline NodeCode with no pre-config.
// ─────────────────────────────────────────────────────────────────────────────

import type { CatalogNode } from '../catalog/catalog-node.js';
import type { CatalogSource } from '../catalog/catalog.js';

export class PipelineCatalogSource implements CatalogSource {
    getCatalogNodes(): CatalogNode[] {
        return [
            {
                key: 'pipeline_classify',
                nodeCodeKey: 'pipeline_classify',
                name: 'Pipeline: Classify',
                group: 'pipeline',
                description: 'Classifies the request, runs Phase 0 reuse check, and routes to the correct pipeline branch.',
                configuration: {},
            },
            {
                key: 'pipeline_factual_search',
                nodeCodeKey: 'pipeline_factual_search',
                name: 'Pipeline: Factual Search',
                group: 'pipeline',
                description: 'Runs the phaibel.factual web-search process and stores results for synthesis.',
                configuration: {},
            },
            {
                key: 'pipeline_category_context',
                nodeCodeKey: 'pipeline_category_context',
                name: 'Pipeline: Category Context',
                group: 'pipeline',
                description: 'Fetches vault context for a known query category and stores results for synthesis.',
                configuration: {},
            },
            {
                key: 'pipeline_gather_context',
                nodeCodeKey: 'pipeline_gather_context',
                name: 'Pipeline: Gather Context',
                group: 'pipeline',
                description: 'Fetches relevant entity context for the action pipeline.',
                configuration: {},
            },
            {
                key: 'pipeline_select_nodes',
                nodeCodeKey: 'pipeline_select_nodes',
                name: 'Pipeline: Select Nodes',
                group: 'pipeline',
                description: 'Asks the categorize LLM to pick the minimal catalog nodes for the request.',
                configuration: {},
            },
            {
                key: 'pipeline_action_loop',
                nodeCodeKey: 'pipeline_action_loop',
                name: 'Pipeline: Action Loop',
                group: 'pipeline',
                description: 'LLM-driven design → execute → check loop (up to 3 iterations).',
                configuration: {},
            },
            {
                key: 'pipeline_synthesize',
                nodeCodeKey: 'pipeline_synthesize',
                name: 'Pipeline: Synthesize',
                group: 'pipeline',
                description: 'Composes the final natural-language response from accumulated results.',
                configuration: {},
            },
            // ── Take on Me pipeline nodes ──────────────────────────────────────
            {
                key: 'tom_contract',
                nodeCodeKey: 'tom_contract',
                name: 'TOM: Contract',
                group: 'pipeline',
                description: 'Decomposes the request into a checklist of verifiable outcomes.',
                configuration: {},
            },
            {
                key: 'tom_flow_loop',
                nodeCodeKey: 'tom_flow_loop',
                name: 'TOM: Flow Loop',
                group: 'pipeline',
                description: 'One small Feral fragment per contract item, evidence-checked with one repair round.',
                configuration: {},
            },
        ];
    }
}
