# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # Compile TypeScript → dist/, copy HTML/JSON assets
npm run dev            # Run with tsx (no compile step needed)
npm test               # Unit tests only (excludes integration)
npm run test:watch     # Unit tests in watch mode
npm run test:integration  # Integration tests (require vault setup)
npm run test:all       # All tests
npm run eval           # Single evaluation run
npm run eval:loop      # Continuous eval loop with auto-tuning
./ship.sh "message"    # build → link → git add/commit/push
```

Run a single test file:
```bash
npx vitest run tests/feral/engine.test.ts
```

## Architecture

Phaibel is a TypeScript CLI/daemon that acts as an AI personal assistant. Every user request dynamically generates a **Feral CCF process** — a directed acyclic graph of reusable logic blocks — rather than following hardcoded workflows.

### Core Pipeline (`src/commands/chat.ts`)

Five LLM calls per request:

| Phase/Step | What happens |
|------------|-------------|
| Phase 1 | LLM tries to reuse a saved process from `.phaibel/processes/` |
| Step 1 | LLM selects relevant catalog nodes |
| Step 2 | LLM generates a Feral JSON process definition |
| Step 4 | LLM validates the process completed successfully |
| Step 5 | LLM synthesizes a natural-language response |

Steps 1–4 use the `reason` capability (Opus/Sonnet). Step 5 uses `chat` (Sonnet/GPT-4o) and is the only step that applies personality/identity.

### Feral CCF Engine (`src/feral/`)

- **Node Codes** (`src/feral/node-code/`) — 30+ logic blocks: LLM calls, entity CRUD, HTTP, flow control, formatting
- **Catalog** (`src/feral/catalog/`) — Registry of configured node instances; entity types auto-generate CRUD nodes
- **Engine** (`src/feral/engine/`) — Executes the DAG, emits `ProcessStart/End/NodeBefore/NodeAfter` events
- **Bootstrap** (`src/feral/bootstrap.ts`) — Wires the full runtime, loads catalog sources

### Entity System (`src/entities/`)

All user data is plain Markdown with YAML frontmatter stored in a "vault" directory. Adding a custom entity type (via `.phaibel/entity-types.json`) auto-generates catalog nodes: `create_X`, `find_X`, `list_Xs`, `update_X`, `delete_X`, `complete_X`, plus per-field setters.

### LLM Router (`src/llm/`)

Routes each capability (`reason`, `chat`, `summarize`, `categorize`, `format`, `embed`) to the best available provider. Supported providers: OpenAI, Anthropic, Google Gemini, DeepSeek. Config lives in `~/.phaibel/secrets.json` and vault-scoped `config.json`.

### Service / Daemon (`src/service/`)

Background daemon (`PHAIBEL_SERVICE=1`) that exposes:
- Unix socket for IPC
- HTTP server on port **3737** (web UI at `web-client.html`)
- REST API (`api-router.ts`) for entity CRUD, cron, calendar, analytics
- Cron scheduler for calendar sync, inbox processing, feedback summarization
- MCP server and A2A (agent-to-agent) server

### Context Assembly

Vault context is assembled per-request by walking `.vault.md` files up the directory tree. Entity types, catalog nodes, saved processes, chat history, and globals (user name, current date) are injected into appropriate pipeline steps — see `context.md` for the full injection map.

### Key Config Locations

| Path | Purpose |
|------|---------|
| `~/.phaibel/secrets.json` | API keys |
| `vault/.state.json` | Agent name, personality, user prefs |
| `vault/.phaibel/config.json` | Per-vault LLM capability overrides |
| `vault/.phaibel/entity-types.json` | Custom entity schemas |
| `vault/.phaibel/processes/` | Saved Feral processes (reused in Phase 1) |

### Environment Variables

| Variable | Effect |
|----------|--------|
| `PHAIBEL_VAULT` | Override vault root path |
| `PHAIBEL_DEBUG=1` | Verbose debug output |
| `PHAIBEL_SERVICE=1` | Internal: marks process as daemon |

## Build Output

`npm run build` compiles TypeScript to `dist/` and copies static assets (HTML clients, tier1 JSON process templates). The build must be run before `phaibel` CLI changes take effect; use `npm run dev` to skip the build step during development.

## Testing Notes

Unit tests live in `tests/feral/` and `tests/tools/`. Integration tests in `tests/integration/` run full entity workflows and require a vault environment — don't run them with `npm test`.

Eval scenarios live in `evals/scenarios/` and score against assertions in `evals/assertions.ts`. Results are stored in `evals/results/` as timestamped JSON.
