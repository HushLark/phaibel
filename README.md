# Phaibel

An AI-powered personal assistant that manages your tasks, events, notes, goals, people, and more — all stored as plain Markdown files in a local "vault" folder.

Choose from 4 personalities and name your agent to make it truly yours.

```
  ____  _           _ _          _
 |  _ \| |__   __ _(_) |__   ___| |
 | |_) | '_ \ / _` | | '_ \ / _ \ |
 |  __/| | | | (_| | | |_) |  __/ |
 |_|   |_| |_|\__,_|_|_.__/ \___|_|

 Your Intelligent Personal Assistant

 ┌─────────────────────────────────────────────┐
 │  "remind me to call the dentist tomorrow"   │
 └──────────────────┬──────────────────────────┘
                    │
                    ▼
 ┌──────────┐  ┌──────────┐  ┌──────────┐
 │ Classify │─▶│ Create   │─▶│ Set Due  │
 │ Request  │  │ Task     │  │ Date     │
 └──────────┘  └──────────┘  └────┬─────┘
                                  │
                    ┌─────────────┘
                    ▼
 ┌──────────┐  ┌──────────┐
 │ Link to  │─▶│ Respond  │
 │ Calendar │  │ to User  │
 └──────────┘  └──────────┘

 Every request builds a unique process graph.
```

## Quick Start

1. **Install and create a vault**
   ```bash
   npm install -g phaibel
   mkdir my-vault && cd my-vault
   phaibel init
   ```

2. **Configure an API key** (prompted during init)
   > Requires a key from [OpenAI](https://platform.openai.com) and/or [Anthropic](https://console.anthropic.com)

3. **Open the web client at [http://localhost:3737](http://localhost:3737)**

   The service starts automatically after init. On first visit you'll choose a personality, name your agent, and optionally fill in some context about yourself. Then just start chatting:

   ```
   remind me to call the dentist tomorrow
   what's on my plate today?
   create a goal to run a half marathon by June
   ```

## Personalities

| Personality | Style |
|-------------|-------|
| **British Butler** | Formal, composed, measured. "Very good, sir." |
| **Rock Star** | High-energy, irreverent, enthusiastic. "Let's shred this to-do list!" |
| **Executive Assistant** | Professional, crisp, efficient. "Done. Next item on your agenda." |
| **Friend** | Warm, casual, supportive peer. "Hey! I took care of that for you." |

## CLI Commands

The CLI is an admin toolkit. The web client at `http://localhost:3737` is the primary user interface.

Run `phaibel --help` to see all commands:

| Command | Description |
|---------|-------------|
| `phaibel init` | Create a new vault in the current directory |
| `phaibel config` | Manage API keys and LLM provider settings |
| `phaibel service start\|stop\|restart\|status` | Manage the background daemon |
| `phaibel queue status\|pause\|resume\|clear` | Inspect the task queue |
| `phaibel index stats\|rebuild\|graph\|neighbors` | Manage the entity relationship graph |
| `phaibel cron list\|enable\|disable\|run` | Manage scheduled background jobs |
| `phaibel calendar add\|remove\|list\|sync` | Manage Google Calendar ICS feeds |
| `phaibel feral` | Inspect the Feral CCF flow engine |
| `phaibel sync` | Git-based vault sync |
| `phaibel setup` | Update your name and preferences |
| `phaibel type list\|add\|edit\|remove` | Manage entity type schemas |
| `phaibel entity <type> [action]` | CRUD for any entity type |
| `phaibel skill` | Manage MCP skill servers |
| `phaibel tool <name> [input]` | Run a registered tool directly |
| `phaibel tools` | List all available tools |

## Content Types

| Type | Description |
|------|-------------|
| **todo** | Tasks with priority, status, and due dates |
| **event** | Calendar events with start/end times and locations |
| **note** | Freeform notes |
| **todont** | Things you're deliberately *not* doing |

Your agent creates new content types as needed — just ask it to track something new.

## How It Works

Phaibel **writes a unique software process for every request**. Instead of following rigid workflows, it dynamically assembles a process graph tailored to what you asked for.

This is powered by **Feral CCF** (Catalog-Code Framework):

- **NodeCode** — reusable logic blocks (e.g., "query todos", "format as markdown", "call LLM")
- **CatalogNodes** — configured instances with default settings
- **ProcessNodes** — nodes wired together into a directed graph for a specific request

The web UI visualizes the process created for each action so you can see exactly what happened.

## BYOK (Bring Your Own Key)

Your keys are stored locally in `~/.phaibel/secrets.json` and never leave your machine.

```bash
phaibel config add-provider openai
phaibel config add-provider anthropic
```

When both providers are configured, Phaibel picks the best model for each task:

| Capability | What it does | OpenAI default | Anthropic default |
|------------|-------------|----------------|-------------------|
| reason | Complex thinking | gpt-4o | claude-sonnet-4-6 |
| chat | Conversation | gpt-4o | claude-sonnet-4-6 |
| summarize | Condensing info | gpt-4o-mini | claude-haiku-4-5 |
| categorize | Classification | gpt-4o-mini | claude-haiku-4-5 |
| format | Text formatting | gpt-4o-mini | claude-haiku-4-5 |
| embed | Vector embeddings | text-embedding-3-small | *(not supported)* |

Override any mapping:

```bash
phaibel config set-capability reason anthropic claude-sonnet-4-6
phaibel config reset-capability reason
```

## Where Things Live

```
~/.phaibel/
  secrets.json         # API keys (never committed)
  phaibel.pid          # Daemon PID
  phaibel.sock         # Unix socket

your-vault/
  .vault.md            # Vault root context (read by the LLM)
  .state.json          # User profile (name, personality, agent name)
  .phaibel/            # Vault-scoped config
    config.json        # LLM capability overrides
    entity-types.json  # Entity type definitions
    logs/              # Chat session logs
    processes/         # Saved Feral processes
  todos/
  events/
  notes/
  goals/
  people/
  recurrences/
  todonts/
  inbox/
```

Every entity is a plain `.md` file. Edit them with any text editor, sync with Git, or back up however you like.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PHAIBEL_VAULT` | Override vault root path |
| `PHAIBEL_SERVICE=1` | Internal: marks the process as the daemon |
| `PHAIBEL_DEBUG=1` | Enable verbose debug output |

## Development

```bash
git clone https://github.com/clift-labs/phaibel.git
cd phaibel
npm install
npm run build
npm link
```

```bash
npm run dev          # Run with tsx (hot reload)
npm test             # Run unit tests
npm run test:all     # Run all tests including integration
```

## Requirements

- Node.js >= 18
- An API key from OpenAI and/or Anthropic

## License

MIT © [Clift Labs](https://github.com/clift-labs)
