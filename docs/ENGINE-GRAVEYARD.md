# Engine Graveyard

Retired chat-pipeline engines. Each entry preserves the design, the measured
results that led to retirement, and the lessons that fed into surviving
engines. Engines are removed from the codebase when retired — resurrect from
git history if ever needed (removal commit is tagged per entry).

Surviving engines as of 2026-07-06: **Standard** (`pipeline.standard`, default)
and **Take on Me** (`pipeline.take-on-me`).

---

## Cruel Summer (`pipeline.cruel-summer`)

*Retired 2026-07-06. Lived in `src/feral/pipelines/cruel-summer-pipeline.ts` +
`src/feral/node-code/pipeline/cs-*.ts` (6 node codes).*

An iterative, validation-heavy pipeline named after the Taylor Swift song.
Unlike Standard (classify → gather → select → design → execute), Cruel Summer
deliberately looped on each phase until an LLM validator said "good", then
defined success criteria before executing, and validated the outcome against
them afterward.

### Flow

```
start
→ cs_categorize            Step 1: classify + extract search params / output spec
  → chat     → cs_synthesize → done    (phatic fast-path)
  → blocked  → done                    (guardrail)
  → ok       → cs_context_loop

cs_context_loop             Step 2: iterative context gathering (inner loop ≤5)
→ cs_define_success         Step 3: LLM writes explicit success criteria
→ cs_node_loop              Step 4: iterative node selection (inner loop ≤5)
→ cs_build_process          Step 5: LLM designs the Feral process JSON
→ cs_execute_process        Step 6: run the generated process inline (run_inline_process)
→ cs_evaluate_success       Step 7: did we meet the criteria?
  → success     → cs_synthesize → done
  → max_retries → cs_synthesize → done
  → retry       → cs_categorize        ← CYCLE (max 3 outer retries, __cs_retry_count)
  → error       → cs_synthesize → done

cs_synthesize               Step 8: compose final response
```

### Findings (engine bake-off, 2026-07-04, 49 scenarios, single rep)

- **Accuracy 84 / Completeness 61 — vs Standard's A89/C77.** Worse on both
  axes despite ~5× the wall clock.
- **3,893s total (Standard: 812s), 4 scenario hangs.** The outer retry cycle
  plus per-phase inner loops compounded latency; hangs came from validator
  loops that never converged.
- **Fixed-loop blindness:** whole-process re-design on retry meant each retry
  re-derived everything from scratch — errors compounded rather than being
  repaired incrementally.
- The "define success first, evaluate after" idea was sound and survives in
  Take on Me's contract (checklist of verifiable outcomes with evidence
  classes), where completion is checked **deterministically** against created
  entities instead of by an LLM judge.

---

## Hertz (`pipeline.hertz`)

*Retired 2026-07-06. Lived in `src/feral/pipelines/hertz-pipeline.ts` +
`src/feral/node-code/pipeline/hz-*.ts` (4 node codes).*

A chain-of-thought pipeline named after the unit of frequency. Unlike Cruel
Summer's fixed sequential phases, Hertz gave the execute step full autonomy to
interleave context queries, catalog searches, process building, and execution
as needed — the most agent-like of the three original engines.

### Flow

```
start
→ hz_categorize            Step 1: classify + safety check
  → chat     → hz_synthesize → done    (phatic fast-path)
  → blocked  → done                    (guardrail)
  → ok       → hz_plan
  → error    → done

hz_plan                    Step 2: CoT planning + initial context fetch
→ hz_execute               Step 3: tool-dispatch loop (max 10 iterations)
→ hz_evaluate              Step 4: check success criteria
  → success     → hz_synthesize → done
  → max_retries → hz_synthesize → done
  → retry       → hz_plan              ← CYCLE (max 2 outer retries, __hz_retry_count)
  → error       → hz_synthesize → done

hz_synthesize              Step 5: compose final user response
```

### Findings (engine bake-off, 2026-07-04, 49 scenarios, single rep)

- **Accuracy 65 / Completeness 53 — the weakest engine measured.**
- **7,545s total (9× Standard), 10 scenario hangs.** The free-form
  tool-dispatch loop frequently failed to terminate: the model kept issuing
  tool calls without committing to execution.
- Full autonomy without structural guardrails underperformed both the rigid
  pipeline (Standard) and the contract-bounded one (Take on Me). The
  tool-dispatch loop's freedom was exactly where it lost accuracy — no
  deterministic evidence check ever forced it to converge.
- Lesson carried forward: Take on Me keeps fragments SMALL and bounds repair
  to one round per contract item — the opposite bet, and it measured at
  Standard parity while ~20% faster.

---

## Shared post-mortem

Both engines bet on **LLM-judged iteration** (loop until a validator approves,
retry the whole design on failure). Both lost to engines that either don't
iterate (Standard) or iterate with **deterministic** completion evidence and
strictly bounded repair (Take on Me). The recurring failure modes:

1. **Non-converging validator loops** → hangs (4 CS, 10 HZ in one suite run).
2. **Whole-process retry** compounds errors; incremental repair beats
   re-derivation.
3. LLM self-evaluation of "success" is unreliable as a loop exit condition;
   checking created-entity evidence deterministically is not.
