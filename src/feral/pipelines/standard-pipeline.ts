// ─────────────────────────────────────────────────────────────────────────────
// Standard Pipeline — Feral process definition
// ─────────────────────────────────────────────────────────────────────────────
//
// The default chat pipeline expressed as a Feral process.  Swapping to a
// different pipeline is as simple as registering a new process and updating
// the active pipeline key in the vault config.
//
// Routing from `pipeline_classify`:
//   chat      → synthesize (phatic exchange)
//   reuse     → synthesize (saved process ran; results already in context)
//   factual   → factual_search → synthesize
//   category  → category_context → synthesize
//   action    → gather_context → select_nodes → action_loop → synthesize
//   blocked   → done (blocked response pre-set by classify)
//   error     → done
// ─────────────────────────────────────────────────────────────────────────────

import { hydrateProcess } from '../process/process-json-hydrator.js';
import type { Process } from '../process/process.js';

export const STANDARD_PIPELINE_KEY = 'pipeline.standard';

export const STANDARD_PIPELINE: Process = hydrateProcess({
    schema_version: 1,
    key: STANDARD_PIPELINE_KEY,
    description: 'Default Phaibel chat pipeline: classify → route → gather → select → design/execute → synthesize.',
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
            edges: {
                ok:    'synthesize',
                error: 'synthesize',
            },
        },
        {
            key: 'category_context',
            catalog_node_key: 'pipeline_category_context',
            configuration: {},
            edges: {
                ok:    'synthesize',
                error: 'synthesize',
            },
        },
        {
            key: 'gather_context',
            catalog_node_key: 'pipeline_gather_context',
            configuration: {},
            edges: {
                ok:    'select_nodes',
                error: 'select_nodes',
            },
        },
        {
            key: 'select_nodes',
            catalog_node_key: 'pipeline_select_nodes',
            configuration: {},
            edges: {
                ok:    'action_loop',
                error: 'synthesize',
            },
        },
        {
            key: 'action_loop',
            catalog_node_key: 'pipeline_action_loop',
            configuration: {},
            edges: {
                ok:    'synthesize',
                error: 'synthesize',
            },
        },
        {
            key: 'synthesize',
            catalog_node_key: 'pipeline_synthesize',
            configuration: {},
            edges: {
                ok: 'done',
            },
        },
        {
            key: 'done',
            catalog_node_key: 'stop',
            configuration: {},
            edges: {},
        },
    ],
});
