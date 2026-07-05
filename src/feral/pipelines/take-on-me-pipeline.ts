// ─────────────────────────────────────────────────────────────────────────────
// Take on Me Pipeline — contract-driven incremental flow assembly
// ─────────────────────────────────────────────────────────────────────────────
//
// Identical front to the standard pipeline (classify → grounded retrieval →
// node selection), but the action path replaces one-shot process design with:
//   tom_contract  — decompose the ask into verifiable outcomes
//   tom_flow_loop — one SMALL Feral fragment per outcome, executed with sight
//                   of prior results; deterministic evidence check against the
//                   contract; exactly one bounded repair round.
//
// Design rationale (2026-07 engine bake-off): one-shot design drops parts of
// multi-part requests (smoke/multi-entity completeness ~50%); blind whole-
// process re-design loops (Cruel Summer/Hertz) compound errors and hang.
// Fragments keep every action a Feral flow — the USP — while giving the model
// tool-loop-style visibility of intermediate results.
// ─────────────────────────────────────────────────────────────────────────────

import type { Process } from '../process/process.js';
import { hydrateProcess } from '../process/process-json-hydrator.js';

export const TAKE_ON_ME_PIPELINE_KEY = 'pipeline.take-on-me';

export const TAKE_ON_ME_PIPELINE: Process = hydrateProcess({
    schema_version: 1,
    key: TAKE_ON_ME_PIPELINE_KEY,
    description: 'Contract-driven flow assembly: classify → ground → per-outcome Feral fragments → evidence-checked completion → synthesize.',
    context: {},
    nodes: [
        {
            key: 'start',
            catalog_node_key: 'start',
            configuration: {},
            edges: { ok: 'classify' },
        },
        {
            key: 'classify',
            catalog_node_key: 'pipeline_classify',
            configuration: {},
            edges: {
                chat:     'synthesize',
                reuse:    'synthesize',
                factual:  'factual_search',
                category: 'category_context',
                action:   'gather_context',
                blocked:  'done',
                error:    'done',
            },
        },
        {
            key: 'factual_search',
            catalog_node_key: 'pipeline_factual_search',
            configuration: {},
            edges: { ok: 'synthesize', error: 'synthesize' },
        },
        {
            key: 'category_context',
            catalog_node_key: 'pipeline_category_context',
            configuration: {},
            edges: { ok: 'synthesize', error: 'synthesize' },
        },
        {
            key: 'gather_context',
            catalog_node_key: 'pipeline_gather_context',
            configuration: {},
            edges: { ok: 'select_nodes', error: 'select_nodes' },
        },
        {
            key: 'select_nodes',
            catalog_node_key: 'pipeline_select_nodes',
            configuration: {},
            edges: { ok: 'contract', error: 'synthesize' },
        },
        {
            key: 'contract',
            catalog_node_key: 'tom_contract',
            configuration: {},
            edges: { ok: 'flow_loop', error: 'flow_loop' },
        },
        {
            key: 'flow_loop',
            catalog_node_key: 'tom_flow_loop',
            configuration: {},
            edges: { ok: 'synthesize', error: 'synthesize' },
        },
        {
            key: 'synthesize',
            catalog_node_key: 'pipeline_synthesize',
            configuration: {},
            edges: { ok: 'done' },
        },
        {
            key: 'done',
            catalog_node_key: 'stop',
            configuration: {},
            edges: {},
        },
    ],
});
