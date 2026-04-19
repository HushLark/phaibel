---
name: innovate
description: "Run 10 eval loops, autonomously tweaking prompts, models, or processes to improve Phaibel's scores"
allowed-tools: Bash(npm run eval:*), Bash(npx tsx evals/*), Bash(git *), Read, Edit, Write, Glob, Grep, Agent
---

# Innovate — Autonomous Eval-Driven Improvement

You are an autonomous improvement agent for Phaibel. Your job is to run evaluation loops, analyze failures, make targeted changes, and re-run evals to measure impact. If a change improves scores, commit it. If not, revert and try something else.

## Arguments

`$ARGUMENTS` specifies what to innovate and optionally a persona/context to target.

**Format**: `<aspect> [for <persona context>]`

Parse it as follows:
1. Extract the **aspect** (first word): `prompts`, `model`, `process`, or `cxms`. Default to `prompts` if missing.
2. Extract the **context** (everything after "for"): a use-case persona describing who Phaibel is serving.

**Examples:**
- `/innovate prompts` — improve prompts using core scenarios only
- `/innovate prompts for parents managing a family calendar` — generate family-oriented scenarios, then improve prompts
- `/innovate model for business users managing multiple teams` — generate business scenarios, then experiment with models
- `/innovate cxms` — improve context assembly (vault context, scope, moment, relevance filtering)
- `/innovate cxms for solo freelancers tracking clients and invoices` — generate freelancer scenarios, then tune context management
- `/innovate for solo freelancers tracking clients and invoices` — defaults to prompts, generates freelancer scenarios

## Workflow — Repeat up to 10 times

### Step 0: Generate Persona Scenarios (only if context was provided)

If the user provided a persona context, generate 6-8 eval scenarios tailored to that persona. Write them to `evals/scenarios/persona.ts`.

The file must follow this exact structure:

```typescript
/**
 * Persona Scenarios — <persona description>
 *
 * Auto-generated for /innovate. These scenarios test Phaibel's ability
 * to handle use cases specific to: <persona description>.
 */
import type { EvalScenario } from '../types.js';

export const personaScenarios: EvalScenario[] = [
    // ... scenarios here
];
```

**How to write good persona scenarios:**

Each scenario needs:
- `id`: kebab-case unique ID prefixed with `persona-` (e.g., `persona-family-dinner-event`)
- `name`: human-readable description
- `category`: always `'persona'`
- `userInput`: realistic natural language that a person with this persona would say to Phaibel
- `assertions`: 1-3 assertions that verify correct behavior

**Scenario design guidelines:**
- Cover all relevant entity types for the persona (events, tasks, goals, notes, people, todonts)
- Include at least one entity-type discrimination test (e.g., "soccer practice" = event, not task)
- Include at least one create-vs-update test (seed an entity, then ask to modify it)
- Include at least one multi-entity test (two things in one message)
- Use realistic language — how would this persona actually talk?
- Test field population where relevant (dates, priorities, statuses)

**Available assertion types:**
- `entity_created` — `{ type, entityType, titleMatch, description }`
- `entity_not_created` — `{ type, entityType, titleMatch, description }`
- `entity_updated` — `{ type, entityType, titleMatch, description }`
- `entity_type_correct` — `{ type, titleMatch, expectedType, description }`
- `entity_field` — `{ type, entityType, titleMatch, field, expected, description }`
- `entity_count` — `{ type, entityType, expected, description }`
- `response_contains` — `{ type, match, description }`

**Available entity types:** task, event, note, goal, person, todont, recurrence

**To seed existing entities** (for update tests), add `vaultSeed`:
```typescript
vaultSeed: [
    { entityType: 'task', title: 'Example Task', fields: { status: 'open', priority: 'medium' } },
],
```

After writing the file, all eval commands should include `--scenarios-file evals/scenarios/persona.ts` to load both core and persona scenarios.

### Step 1: Run baseline eval

```bash
npm run eval -- --label "baseline-$(date +%s)" --scenarios-file evals/scenarios/persona.ts
```

(Omit `--scenarios-file` if no persona context was provided.)

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

#### If "cxms":

Innovate on **context assembly** — what vault context, scope, moment information, and catalog relevance filtering the LLM receives. Do NOT modify context type schemas, catalog node generation, or search indexes (embedding/BM25).

Key files:
- `src/context/reader.ts` — `buildContextChain()`: walks `.cxms.md`/`.vault.md` files up the directory tree. Try adjusting what gets included or how much is trimmed.
- `src/context/moment.ts` — `buildMomentContext()` / `formatMomentBlock()`: current date, overdue tasks, upcoming schedule injected as globals. Try adjusting what moment signals are surfaced or how they're formatted.
- `src/context/context-tree.ts` — `buildContextTree()` / `expandContextTree()`: structures context into scoped branches. Try adjusting depth limits or token budgets.
- `src/context/context-tree-serializer.ts` — `serializeContextTree()`: converts the tree to markdown for the prompt. Try adjusting formatting or section ordering.
- `src/context/scope-classifier.ts` — `classifyScope()`: determines which vault subdirectories are relevant to a request. Try tightening or broadening classification rules.
- `src/context/query-relevance.ts` — `analyzeQueryRelevance()` / `filterCatalogNodes()`: pre-filters catalog nodes before Step 1. Try adjusting keyword extraction or relevance thresholds.

These are all imported and used in `src/commands/chat.ts` lines 229-266 (context assembly block).

Make small, targeted edits. Examples:
- Adjust how many overdue tasks appear in the moment block
- Change the scope classifier to include a broader or narrower set of subdirectories
- Tune the relevance threshold so fewer (or more) catalog nodes reach the LLM
- Adjust context tree serialization to front-load the most relevant branch

#### If "process":
Create or modify saved Feral process JSON files. Processes live in the vault's `.phaibel/processes/` directory.
A process is a JSON file with: `schema_version`, `key`, `description`, `context`, `nodes[]`, `edges[]`.
See example processes in `src/commands/chat.ts` lines 54-170 (`EXAMPLE_PROCESSES`).

Creating a saved process for a common pattern (like "create event from appointment mention") lets Phase 1 of the chat pipeline reuse it directly, bypassing the multi-step LLM pipeline.

### Step 4: Run eval again

```bash
npm run eval -- --label "loop-N-description-of-change" --scenarios-file evals/scenarios/persona.ts
```

(Omit `--scenarios-file` if no persona context.)

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
8. **Persona scenarios are additive** — never remove or skip core scenarios. Persona scenarios run alongside them.
