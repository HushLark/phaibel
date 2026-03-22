---
name: innovate
description: "Run 10 eval loops, autonomously tweaking prompts, models, or processes to improve Phaibel's scores"
allowed-tools: Bash(npm run eval:*), Bash(npx tsx evals/*), Bash(git *), Read, Edit, Write, Glob, Grep, Agent
---

# Innovate — Autonomous Eval-Driven Improvement

You are an autonomous improvement agent for Phaibel. Your job is to run evaluation loops, analyze failures, make targeted changes, and re-run evals to measure impact. If a change improves scores, commit it. If not, revert and try something else.

## Arguments

`$ARGUMENTS` specifies the aspect to innovate on. Parse it as follows:
- **"prompts"** — Improve the LLM prompts in `src/commands/chat.ts` and `src/llm/router.ts`
- **"process"** — Improve or create Feral processes (JSON files in vault `.phaibel/processes/`)
- **"model"** — Experiment with different model assignments in `src/config.ts`
- If empty or unrecognized, default to **"prompts"**

## Workflow — Repeat up to 10 times

### Step 1: Run baseline eval

```bash
npm run eval -- --label "baseline-$(date +%s)"
```

Read the result JSON from `evals/results/`. Note the overall score, per-scenario pass/fail, and failing assertion details.

### Step 2: Diagnose failures

For each failing scenario, read:
- The `responseText` — what did Phaibel actually say/do?
- The `assertionResults` — which specific assertions failed and why?
- The `error` field — did the scenario crash?

Identify the root cause. Common failure patterns:
- Wrong entity type selected → prompt doesn't emphasize type discrimination enough
- Failed to update existing entity → prompt doesn't explain find-then-update flow
- Missing fields on created entity → process doesn't populate field configs
- Timeout → model too slow or process too complex

### Step 3: Make ONE targeted change

Based on the aspect (`$ARGUMENTS`):

#### If "prompts":
Key files and locations:
- `src/llm/router.ts` lines 76-108 — `createSystemPrompt()`: the base system prompt with identity, capabilities, thinking model, personality, and guidelines
- `src/commands/chat.ts` lines 382-450 — Step 1 prompt (node selection): tells the LLM which catalog nodes to pick. Contains entity type descriptions, rules for matching entity types, and instructions for linking
- `src/commands/chat.ts` lines 447 — Step 1 system prompt: "You are the reasoning engine for Phaibel..."
- `src/commands/chat.ts` lines 571-630 — Step 2 prompt (process generation): tells the LLM to generate a Feral process JSON with selected nodes
- `src/commands/chat.ts` lines 723-780 — Completion check prompt

Make small, targeted edits. Examples:
- Add a clarifying sentence about when to use `create_event` vs `create_task`
- Add an example of the expected behavior for the failing case
- Strengthen instructions about checking for existing entities before creating
- Add entity type discrimination rules

#### If "model":
Key file: `src/config.ts` lines 18-46
- `PROVIDER_MODELS` — which model each provider uses per capability
- `CAPABILITY_PREFERRED_PROVIDERS` — which provider is preferred per capability

Try changing one capability's model assignment. Examples:
- Switch `reason` from `claude-opus-4-6` to `claude-sonnet-4-6` (cheaper, sometimes comparable)
- Switch `chat` provider preference order
- Try `gpt-4o` for `reason` instead of Claude

#### If "process":
Create or modify saved Feral process JSON files. Processes live in the vault's `.phaibel/processes/` directory.
A process is a JSON file with: `schema_version`, `key`, `description`, `context`, `nodes[]`, `edges[]`.
See example processes in `src/commands/chat.ts` lines 54-170 (`EXAMPLE_PROCESSES`).

Creating a saved process for a common pattern (like "create event from appointment mention") lets Phase 1 of the chat pipeline reuse it directly, bypassing the multi-step LLM pipeline.

### Step 4: Run eval again

```bash
npm run eval -- --label "loop-N-description-of-change"
```

### Step 5: Compare results

```bash
npm run eval:compare evals/results/BASELINE.json evals/results/LATEST.json
```

Read both result files and compare:
- Did overall score improve?
- Did any previously passing scenarios regress?
- Did the targeted failing scenario(s) now pass?

### Step 6: Decide

- **If improved with no regressions**: Keep the change. Update the baseline by copying the result to `evals/results/_baseline.json`. Stage and commit the changed source files + eval results with a descriptive message.
- **If improved but has regressions**: Keep only if net positive. Commit with a note about the regression.
- **If no improvement or worse**: Revert the change (`git checkout -- <files>`). Try a different approach in the next loop.

### Step 7: Repeat

Go back to Step 2 with the new results. Stop after 10 loops or when all scenarios pass.

## Rules

1. **One change per loop** — don't combine prompt + model changes. Isolate variables.
2. **Small changes** — edit 1-5 lines at a time. Big rewrites are hard to diagnose.
3. **Always compare** — never commit without running the eval.
4. **Never break passing tests** — a regression without a larger gain is not acceptable.
5. **Log your reasoning** — before each change, explain what you're trying and why in the commit message.
6. **Read before editing** — always read the file before modifying it.
7. **Revert failures** — if a change doesn't help, revert it before trying the next thing.
