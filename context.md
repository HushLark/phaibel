# Phaibel Prompt & Context Architecture

## The 5 LLM Calls

| Step | Purpose | System Prompt | Model |
|------|---------|---------------|-------|
| Phase 1 | Process Reuse | Static matcher prompt | reason (Opus) |
| Step 1 | Node Selection | Static reasoning engine prompt | reason (Opus) |
| Step 2 | Process Generation | Static designer prompt | reason (Opus) |
| Step 4 | Completion Check | Static checker prompt | reason (Opus) |
| Step 5 | Synthesis/Response | `createSystemPrompt()` with vault context | chat (Sonnet) |

## Static Context (shipped with the code)

| What | Where | Description |
|------|-------|-------------|
| Agent identity block | `router.ts:80-83` | "You are {agentName}, a Personal Digital Agent..." |
| Capabilities block | `router.ts:85-92` | What the agent can do |
| Guidelines block | `router.ts:99-105` | Be concise, proactive, honest |
| 4 personality templates | `personalities.ts:20-201` | butler, rockstar, executive, friend — each has a `systemPromptBlock` |
| 5 system prompts | `chat.ts` | One per pipeline step — hardcoded role instructions |
| Process format rules | `chat.ts:593-614` | 20 numbered rules for generating valid Feral JSON |
| 7 example processes | `chat.ts:54-172` | Hardcoded examples showing correct process structure |
| Default entity types | `entity-types-defaults.ts:9-59` | task, note, event, todont — with fields and enums |
| Built-in node descriptions | `src/feral/catalog/` | Each NodeCode has a key, name, description |
| Model routing defaults | `config.ts:18-46` | Which model handles which capability |

## Evolving Context (changes per vault, user, session, or day)

| What | Source | Injected Where | Evolves When |
|------|--------|----------------|--------------|
| Agent name | `.state.json` → `agentName` | System prompt + personality block | User sets during setup |
| User name | `.state.json` → `userName` | Globals block (`user_name`) | User sets during setup |
| Personality choice | `.state.json` → `personality` | Selects which template to use | User sets during setup |
| Current date | Computed at runtime | Globals block (`current_date`) | Daily |
| Vault context | `.vault.md` files (walks up directory tree) | Steps 1, 2, and Synthesis | User edits freely |
| Entity types | `.phaibel/entity-types.json` | Step 1 — formatted as type/fields/enums | User adds/modifies types |
| Catalog nodes | Generated from entity types + built-ins | Steps 1 and 2 | Whenever entity types change |
| Saved processes | `.phaibel/processes/*.json` | Phase 1 — listed for reuse matching | User creates or generates |
| Chat history | Passed from caller | Steps 1, 2, and Synthesis | Every conversation turn |
| Existing entities | Scanned from vault directories | Step 2 — for create-vs-update decisions | As entities are created/modified |
| Feedback summary | `.phaibel/feedback-summary.md` (cron-generated) | **NOT INJECTED YET** | Cron job analyzes reactions |

## Assembly Flow

```
Startup (cached)
  └─ agent name + personality block (from .state.json + personalities.ts)

Per Request (chat.ts lines 236-266)
  ├─ vault context    ← .vault.md chain, scrubbed for secrets
  ├─ entity types     ← .phaibel/entity-types.json or defaults
  ├─ globals          ← user_name + current_date
  ├─ catalog nodes    ← built-in nodes + entity-specific nodes
  └─ saved processes  ← .phaibel/processes/*.json

Phase 1: {userInput} + {history} + {processSummary}
Step 1:  {userInput} + {history} + {globals} + {vaultContext} + {entityTypes} + {catalogSummary}
Step 2:  {userInput} + {history} + {previousResults} + {existingEntities} + {globals}
         + {vaultContext} + {selectedNodes} + {nodeCodeDetails} + {examples} + {rules}
Step 4:  {userInput} + {allReasonings} + {allResults}
Step 5:  createSystemPrompt(vaultContext) + {userInput} + {history} + {reasoning} + {results}
```

## Design Notes

1. **Feedback summary is generated but never injected** — written to `.phaibel/feedback-summary.md` by cron but no prompt reads it.
2. **Personality is cached at startup** — changing mid-session requires `refreshSystemPromptCache()`.
3. **Entity types drive catalog generation** — adding a type auto-creates `create_X`, `find_X`, `list_Xs`, `update_X`, `delete_X`, `complete_X`, and per-field `set_X_fieldName` nodes.
4. **Only Synthesis uses `createSystemPrompt()`** — the other 4 steps have hardcoded system prompts, so personality/identity only appears in the final response.
5. **Vault context is a chain** — walks up the directory tree collecting all `.vault.md` files; subdirectory context stacks on root context.
