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
            // ── Cruel Summer pipeline nodes ────────────────────────────────────
            {
                key: 'cs_categorize',
                nodeCodeKey: 'cs_categorize',
                name: 'CS: Categorize Request',
                group: 'pipeline',
                description: 'Step 1 — Extracts context search params, output spec, and request type.',
                configuration: {},
            },
            {
                key: 'cs_context_loop',
                nodeCodeKey: 'cs_context_loop',
                name: 'CS: Get Context (loop)',
                group: 'pipeline',
                description: 'Step 2 — Iteratively gathers and validates entity context (max 5 inner loops).',
                configuration: {},
            },
            {
                key: 'cs_define_success',
                nodeCodeKey: 'cs_define_success',
                name: 'CS: Define Success',
                group: 'pipeline',
                description: 'Step 3 — LLM defines explicit, verifiable success criteria before building a process.',
                configuration: {},
            },
            {
                key: 'cs_node_loop',
                nodeCodeKey: 'cs_node_loop',
                name: 'CS: Get Nodes (loop)',
                group: 'pipeline',
                description: 'Step 4 — Iteratively selects and validates catalog nodes (max 5 inner loops).',
                configuration: {},
            },
            {
                key: 'cs_build_process',
                nodeCodeKey: 'cs_build_process',
                name: 'CS: Build Process',
                group: 'pipeline',
                description: 'Step 5 — LLM designs the Feral process JSON targeting the success criteria.',
                configuration: {},
            },
            {
                // Reuses run_inline_process NodeCode, pre-wired to __cs_process_json
                key: 'cs_execute_process',
                nodeCodeKey: 'run_inline_process',
                name: 'CS: Execute Process',
                group: 'pipeline',
                description: 'Step 6 — Runs the generated process from __cs_process_json inline.',
                configuration: {
                    process_json_context_key: '__cs_process_json',
                },
            },
            {
                key: 'cs_evaluate_success',
                nodeCodeKey: 'cs_evaluate_success',
                name: 'CS: Evaluate Success',
                group: 'pipeline',
                description: 'Step 7 — LLM checks success criteria. Routes "retry" → cs_categorize or "success" → synthesize.',
                configuration: {},
            },
            // ── Hertz pipeline nodes ───────────────────────────────────────────
            {
                key: 'hz_categorize',
                nodeCodeKey: 'hz_categorize',
                name: 'Hz: Categorize Request',
                group: 'pipeline',
                description: 'Step 1 — Classifies intent and routes to planning or synthesis fast-path.',
                configuration: {},
            },
            {
                key: 'hz_plan',
                nodeCodeKey: 'hz_plan',
                name: 'Hz: Plan',
                group: 'pipeline',
                description: 'Step 2 — Chain-of-thought planning: initial context fetch + execution plan with success criteria.',
                configuration: {},
            },
            {
                key: 'hz_execute',
                nodeCodeKey: 'hz_execute',
                name: 'Hz: Execute',
                group: 'pipeline',
                description: 'Step 3 — Tool-dispatch loop: context query, catalog query, build process, or execute process.',
                configuration: {},
            },
            {
                key: 'hz_evaluate',
                nodeCodeKey: 'hz_evaluate',
                name: 'Hz: Evaluate',
                group: 'pipeline',
                description: 'Step 4 — Checks success criteria. Routes "retry" → hz_plan for replanning.',
                configuration: {},
            },
        ];
    }
}
