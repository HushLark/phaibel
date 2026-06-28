// ─────────────────────────────────────────────────────────────────────────────
// Hertz Pipeline — Feral process definition
// ─────────────────────────────────────────────────────────────────────────────
//
// A chain-of-thought pipeline named after the unit of frequency.  Unlike
// Cruel Summer's fixed sequential phases, Hertz gives the execute step full
// autonomy to interleave context queries, catalog searches, process building,
// and execution as needed.
//
// Flow:
//   start
//   → hz_categorize            Step 1: classify + safety check
//     → chat     → hz_synthesize → done    (phatic fast-path)
//     → blocked  → done                    (guardrail)
//     → ok       → hz_plan
//     → error    → done
//
//   hz_plan                    Step 2: CoT planning + initial context fetch
//   → hz_execute               Step 3: tool-dispatch loop (max 10 iterations)
//   → hz_evaluate              Step 4: check success criteria
//     → success     → hz_synthesize → done
//     → max_retries → hz_synthesize → done
//     → retry       → hz_plan              ← CYCLE (max 2 outer retries)
//     → error       → hz_synthesize → done
//
//   hz_synthesize              Step 5: compose final user response
//
// The retry cycle is guarded by __hz_retry_count; each retry routes back to
// hz_plan so the agent can replan with full awareness of the prior failure.
// ─────────────────────────────────────────────────────────────────────────────

import { hydrateProcess } from '../process/process-json-hydrator.js';
import type { Process } from '../process/process.js';

export const HERTZ_PIPELINE_KEY = 'pipeline.hertz';

export const HERTZ_PIPELINE: Process = hydrateProcess({
    schema_version: 1,
    key: HERTZ_PIPELINE_KEY,
    description: 'Chain-of-thought pipeline: categorize → plan → execute → evaluate (retry up to 2×) → synthesize.',
    context: {
        __hz_retry_count: 0,
    },
    nodes: [
        {
            key: 'start',
            catalog_node_key: 'start',
            configuration: {},
            edges: { ok: 'hz_categorize' },
        },
        {
            key: 'hz_categorize',
            catalog_node_key: 'hz_categorize',
            configuration: {},
            edges: {
                ok:      'hz_plan',
                chat:    'hz_synthesize',
                blocked: 'done',
                error:   'done',
            },
        },
        {
            key: 'hz_plan',
            catalog_node_key: 'hz_plan',
            configuration: {},
            edges: {
                ok:    'hz_execute',
                error: 'hz_execute',
            },
        },
        {
            key: 'hz_execute',
            catalog_node_key: 'hz_execute',
            configuration: {},
            edges: {
                ok:    'hz_evaluate',
                error: 'hz_synthesize',
            },
        },
        {
            key: 'hz_evaluate',
            catalog_node_key: 'hz_evaluate',
            configuration: {},
            edges: {
                success:     'hz_synthesize',
                max_retries: 'hz_synthesize',
                retry:       'hz_plan',         // ← intentional back-edge
                error:       'hz_synthesize',
            },
        },
        {
            key: 'hz_synthesize',
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
