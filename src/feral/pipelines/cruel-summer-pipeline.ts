// ─────────────────────────────────────────────────────────────────────────────
// Cruel Summer Pipeline — Feral process definition
// ─────────────────────────────────────────────────────────────────────────────
//
// An iterative, validation-heavy pipeline named after the Taylor Swift song.
// Unlike the standard pipeline (classify → gather → select → design → execute),
// Cruel Summer deliberately loops on each phase until an LLM validator says
// "good", then defines success before executing, and validates the outcome.
//
// Flow:
//   start
//   → cs_categorize            Step 1: classify + extract search params / output spec
//     → chat     → cs_synthesize → done    (phatic fast-path)
//     → blocked  → done                   (guardrail)
//     → ok       → cs_context_loop
//
//   cs_context_loop             Step 2: iterative context gathering (inner loop ≤5)
//   → cs_define_success         Step 3: LLM writes explicit success criteria
//   → cs_node_loop              Step 4: iterative node selection (inner loop ≤5)
//   → cs_build_process          Step 5: LLM designs the Feral process JSON
//   → cs_execute_process        Step 6: run the generated process inline
//   → cs_evaluate_success       Step 7: did we meet the criteria?
//     → success     → cs_synthesize → done
//     → max_retries → cs_synthesize → done
//     → retry       → cs_categorize         ← CYCLE (max 3 outer retries)
//     → error       → cs_synthesize → done
//
//   cs_synthesize               Step 8: compose final response for the user
//
// The outer retry cycle is guarded by __cs_retry_count in context.
// Feral's engine follows edges without enforcing acyclicity, so the back-edge
// from cs_evaluate_success → cs_categorize is intentional.
// ─────────────────────────────────────────────────────────────────────────────

import { hydrateProcess } from '../process/process-json-hydrator.js';
import type { Process } from '../process/process.js';

export const CRUEL_SUMMER_PIPELINE_KEY = 'pipeline.cruel-summer';

export const CRUEL_SUMMER_PIPELINE: Process = hydrateProcess({
    schema_version: 1,
    key: CRUEL_SUMMER_PIPELINE_KEY,
    description: 'Iterative pipeline: categorize → context loop → define success → node loop → build → execute → evaluate (retry up to 3×) → synthesize.',
    context: {
        __cs_retry_count: 0,
    },
    nodes: [
        {
            key: 'start',
            catalog_node_key: 'start',
            configuration: {},
            edges: { ok: 'cs_categorize' },
        },
        {
            key: 'cs_categorize',
            catalog_node_key: 'cs_categorize',
            configuration: {},
            edges: {
                ok:      'cs_context_loop',
                chat:    'cs_synthesize',
                blocked: 'done',
                error:   'done',
            },
        },
        {
            key: 'cs_context_loop',
            catalog_node_key: 'cs_context_loop',
            configuration: {},
            edges: {
                ok:    'cs_define_success',
                error: 'cs_define_success',
            },
        },
        {
            key: 'cs_define_success',
            catalog_node_key: 'cs_define_success',
            configuration: {},
            edges: {
                ok:    'cs_node_loop',
                error: 'cs_node_loop',
            },
        },
        {
            key: 'cs_node_loop',
            catalog_node_key: 'cs_node_loop',
            configuration: {},
            edges: {
                ok:    'cs_build_process',
                error: 'cs_synthesize',
            },
        },
        {
            key: 'cs_build_process',
            catalog_node_key: 'cs_build_process',
            configuration: {},
            edges: {
                ok:    'cs_execute_process',
                error: 'cs_synthesize',
            },
        },
        {
            key: 'cs_execute_process',
            catalog_node_key: 'cs_execute_process',
            configuration: {},
            edges: {
                ok:    'cs_evaluate_success',
                error: 'cs_evaluate_success',
            },
        },
        {
            key: 'cs_evaluate_success',
            catalog_node_key: 'cs_evaluate_success',
            configuration: {},
            edges: {
                success:     'cs_synthesize',
                max_retries: 'cs_synthesize',
                retry:       'cs_categorize',   // ← intentional back-edge
                error:       'cs_synthesize',
            },
        },
        {
            key: 'cs_synthesize',
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
