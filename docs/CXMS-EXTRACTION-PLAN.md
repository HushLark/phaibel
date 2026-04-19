# CxMS Extraction Plan

**Status:** Planning
**Created:** 2026-04-17
**Context:** A separate World Model Synthesizer component needs read/write access to the same context store that Phaibel uses. Two writers to the same store requires a shared service with a single index to avoid consistency drift.

---

## Motivation

Phaibel currently owns the Context Management System (CxMS) in-process. A new World Model Synthesizer component will ingest context from email, Slack, Linear, Notion, and other tools and write it into the same store. Two processes writing to the same Foundation directory with separate in-memory indexes creates race conditions and stale reads. CxMS must become a standalone service that both components connect to as clients.

---

## Architecture

```
┌──────────────────┐     ┌──────────────────┐
│  World Model     │     │    Phaibel        │
│  Synthesizer     │     │    Agent          │
│                  │     │                   │
│  email, slack,   │     │  chat, feral,     │
│  linear, notion  │     │  cron, tools      │
└────────┬─────────┘     └────────┬──────────┘
         │  HTTP + MCP            │  HTTP + MCP
         │                        │
    ┌────▼────────────────────────▼────┐
    │          CxMS Service            │
    │                                  │
    │  Storage (files)                 │
    │  Index (in-memory graph)         │
    │  Embeddings (semantic search)    │
    │  Context Trees                   │
    │  Collections                     │
    │  Boundary Guard                  │
    └──────────────────────────────────┘
              │
              ▼
         Foundation
         (filesystem)
```

### Ownership

CxMS owns:
- Foundation directory format (Markdown + YAML frontmatter)
- Directory structure and migrations (v4→v5, future)
- In-memory node+edge index (single source of truth)
- Embedding index (OpenAI vectors, `.phaibel/embeddings.json`)
- Context tree building (scope classification, serialization, token budgeting)
- Reference resolution (@mentions, type:slug)
- Moment context (overdue tasks, schedule)
- Collections (key/value enumerations)
- Search (keyword + semantic)
- Boundary guard (path traversal prevention)
- Access logging

Neither Phaibel nor the synthesizer touch the filesystem directly.

---

## API Surface

### HTTP REST (`/cx/*`)

Existing endpoints (unchanged signatures):

```
GET  /cx/health
POST /cx/search                        { query, type?, tags? }
GET  /cx/tag/{tag}
GET  /cx/date
GET  /cx/date-range/{start}/{end}
GET  /cx/collections
GET  /cx/collection/{name}
GET  /cx/collection/{name}/{key}
GET  /cx/collection/{name}/count
GET  /cx/context-types
GET  /cx/context-types/count
POST /cx/context-types                 { name, plural, fields, ... }
GET  /cx/context-types/{type}          ?status=&tag=&limit=&offset=
GET  /cx/context-types/{type}/count
GET  /cx/context-types/{type}/details
PUT  /cx/context-types/{type}
DELETE /cx/context-types/{type}
GET  /cx/context-types/{type}/{id}
POST /cx/context-types/{type}          { title, tags?, content?, ...fields }
PUT  /cx/context-types/{type}/{id}     { title?, tags?, content?, ...fields }
DELETE /cx/context-types/{type}/{id}
```

New endpoints:

```
POST /cx/context-tree                  { scope, globals? } → serialized markdown
GET  /cx/moment                        → { current_date, overdue_tasks, tasks_due_today, todays_schedule, ... }
POST /cx/references/resolve            { text } → { references, formatted }
GET  /cx/index/stats                   → { nodeCount, edgeCount, byType }
GET  /cx/index/neighbors/{type}/{id}   → { edges: [{ source, target, edgeType, label }] }
POST /cx/batch                         [{ op, type, id?, title?, ... }] → [{ ok, id?, error? }]
POST /cx/relevance                     { query } → { keywords, relevantTypes, mentionedTypes, hint }
```

### MCP (`/mcp`)

| Tool | Input | Description |
|------|-------|-------------|
| `search` | `{ query, type? }` | Keyword + semantic search, top 20 |
| `list_nodes` | `{ type, status?, tag? }` | List by type with filters |
| `get_node` | `{ type, id }` | Full node with content + references |
| `create_node` | `{ type, title, content?, fields? }` | Create entity |
| `update_node` | `{ type, id, title?, content?, fields? }` | Update existing entity |
| `delete_node` | `{ type, id }` | Soft delete to .trash/ |
| `list_types` | `{}` | All type schemas with fields |
| `context_tree` | `{ query?, scope?, globals? }` | Build + serialize context tree |
| `batch_write` | `{ operations: [{ op, type, ... }] }` | Bulk create/update for ingestion |

### Events (WebSocket or SSE, future)

```
node.created   { type, id, title }
node.updated   { type, id, fields }
node.deleted   { type, id }
index.rebuilt   { nodeCount, edgeCount }
```

Allows Phaibel to refresh its UI panels without polling.

---

## Package Structure

```
packages/cxms/
├── package.json              @phaibel/cxms
├── src/
│   ├── index.ts              Public API facade
│   ├── types.ts              Canonical types (ContextType, ContextNode, etc.)
│   │
│   ├── storage/
│   │   ├── entity.ts         Read/write markdown+YAML files
│   │   ├── entity-validator.ts  Field validation
│   │   ├── collections.ts    Key/value store
│   │   └── boundary-guard.ts Path traversal prevention
│   │
│   ├── schema/
│   │   ├── entity-type-config.ts  Type registry (load, add, update, remove)
│   │   ├── entity-types-defaults.ts  Built-in types (task, note, event, todont)
│   │   └── context-type-store.ts  .phaibel.md schema persistence
│   │
│   ├── index/
│   │   ├── entity-index.ts   In-memory node+edge graph
│   │   └── embedding-index.ts  OpenAI embedding vectors
│   │
│   ├── context/
│   │   ├── context-tree.ts         Scope-based hierarchical views
│   │   ├── context-tree-serializer.ts  Token-budgeted markdown output
│   │   ├── scope-classifier.ts     Heuristic scope selection
│   │   ├── query-relevance.ts      Deterministic type filtering
│   │   ├── mentions.ts             @slug + type:slug resolution
│   │   ├── moment.ts               Real-time task/schedule context
│   │   └── reader.ts               .vault.md/.phaibel.md chain reader
│   │
│   ├── server/
│   │   ├── http-server.ts    Standalone HTTP server
│   │   ├── cx-router.ts      REST route handler (moved from Phaibel)
│   │   ├── mcp-server.ts     MCP tool registration
│   │   └── problem-details.ts  RFC 9457 error formatting
│   │
│   ├── migration/
│   │   └── auto-migrate.ts   v4→v5 (and future migrations)
│   │
│   └── log/
│       └── access-log.ts     Apache Combined Log Format
│
├── bin/
│   └── cxms.ts               CLI entry: cxms serve --foundation <path> --port 3838
│
└── tsconfig.json
```

```
packages/cxms-client/
├── package.json              @phaibel/cxms-client
├── src/
│   ├── index.ts              Public API (same function signatures as @phaibel/cxms)
│   ├── http-client.ts        HTTP client wrapping /cx/* endpoints
│   └── types.ts              Re-exported from @phaibel/cxms
└── tsconfig.json
```

---

## Migration Steps

### Step 1: Package boundary (no behavior change)

Move CxMS source files into `packages/cxms/` as a local npm workspace package. Phaibel imports from `@phaibel/cxms` instead of relative paths. Everything stays in-process. No new service, no network calls.

**Files moved from Phaibel to `packages/cxms/src/`:**
- `src/cxms/*` → `storage/`, `schema/`, `server/`, `log/`, `migration/`, `types.ts`
- `src/entities/entity.ts` → `storage/entity.ts`
- `src/entities/entity-validator.ts` → `storage/entity-validator.ts`
- `src/entities/entity-index.ts` → `index/entity-index.ts`
- `src/entities/embedding-index.ts` → `index/embedding-index.ts`
- `src/entities/entity-type-config.ts` → `schema/entity-type-config.ts`
- `src/entities/entity-types-defaults.ts` → `schema/entity-types-defaults.ts`
- `src/context/*` → `context/*`

**Files that stay in Phaibel:**
- `src/commands/entity.ts` (CLI command, thin wrapper)
- `src/commands/entity-type.ts` (CLI command, thin wrapper)
- `src/service/web-server.ts` (delegates to CxMS router)
- Everything in `src/feral/`, `src/llm/`, `src/commands/chat.ts`, etc.

**Validation:** `npm run build` passes, all evals pass, no behavior change.

### Step 2: Standalone HTTP + MCP server

Add `packages/cxms/src/server/http-server.ts` that starts a standalone HTTP server. Add MCP tool registration. Add CLI entry point (`cxms serve`).

CxMS can now run as:
- An in-process library (Step 1 mode, for tests and simple deployments)
- A standalone service (`cxms serve --foundation ~/vault --port 3838`)

**New endpoints:** `POST /cx/context-tree`, `GET /cx/moment`, `POST /cx/references/resolve`, `POST /cx/batch`, `GET /cx/index/stats`, `GET /cx/index/neighbors/{type}/{id}`, `POST /cx/relevance`.

**New MCP tools:** `update_node`, `delete_node`, `context_tree`, `batch_write`.

**Validation:** `curl localhost:3838/cx/health` returns 200. MCP inspector connects. Evals pass.

### Step 3: CxMS client package

Create `packages/cxms-client/` with the same function signatures as `@phaibel/cxms` but implemented over HTTP. This is a drop-in replacement.

```typescript
// @phaibel/cxms (direct, in-process)
import { listEntities } from '@phaibel/cxms';

// @phaibel/cxms-client (network, same signature)
import { listEntities } from '@phaibel/cxms-client';
```

**Validation:** Swap Phaibel's import, run evals against CxMS service. Same results.

### Step 4: Phaibel spawns CxMS

Update `phaibel service start` to:
1. Start CxMS service on port 3838 (child process or in-process)
2. Start Phaibel web server on port 3737
3. Phaibel connects to CxMS via `@phaibel/cxms-client`

User experience unchanged — `phaibel service start` still does everything.

**Validation:** Full integration test. Chat works. Entity CRUD works. Evals pass.

### Step 5: World Model Synthesizer connects

The synthesizer connects to CxMS on port 3838 using `@phaibel/cxms-client` or raw HTTP/MCP. It writes ingested context (emails, Slack messages, Linear tickets) into the Foundation. Phaibel sees those nodes immediately through the shared index.

---

## Latency Budget

| Operation | Current (in-process) | After extraction (localhost HTTP) |
|-----------|---------------------|----------------------------------|
| listEntities | ~1ms (index lookup) | ~1.5ms |
| createEntity | ~5ms (file write + index update) | ~6ms |
| searchEntities | ~2ms (keyword) | ~3ms |
| buildContextTree | ~10ms | ~12ms (single call replaces 6+ internal calls) |
| Full chat pipeline | 3–15s (LLM dominated) | 3–15s (CxMS adds <5ms total) |

Localhost HTTP overhead is ~0.1–0.3ms per request. The LLM calls dominate by 1000x.

---

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Wire protocol | HTTP + JSON | Debuggable with curl, fast enough on localhost |
| Storage engine | Markdown files (for now) | Works at current scale. Swap to SQLite/Postgres inside CxMS later without client changes. |
| Index location | In CxMS process only | Single writer = always consistent. No distributed index. |
| Auth | None (localhost only, for now) | Add bearer tokens when CxMS goes to a network boundary. |
| MCP | Expose alongside HTTP | External AI tools (Claude Code, etc.) connect via MCP. |
| Foundation format | Owned by CxMS | Neither Phaibel nor the synthesizer touch the filesystem directly. |
| Context tree building | Server-side in CxMS | One call to `POST /cx/context-tree` replaces 6+ in-process calls. Phaibel gets a serialized string. |
| Event notifications | Deferred to Step 5+ | WebSocket/SSE for node.created/updated/deleted. Not needed until synthesizer is writing in production. |

---

## Security

### Transport: Unix Domain Sockets / Named Pipes

CxMS listens on a local socket instead of a TCP port. This prevents any network-reachable process from connecting.

| Platform | Transport | Path |
|----------|-----------|------|
| macOS / Linux | Unix domain socket | `~/.phaibel/cxms.sock` (mode `0600`) |
| Windows | Named pipe | `\\.\pipe\phaibel-cxms` |

Node.js `net.createServer` handles both transparently — the only difference is the listen path string.

```typescript
import { platform } from 'os';

const SOCKET_PATH = platform() === 'win32'
    ? '\\\\.\\pipe\\phaibel-cxms'
    : path.join(os.homedir(), '.phaibel', 'cxms.sock');
```

On macOS/Linux, file permissions (`0600`) restrict the socket to the owning user. On Windows, named pipes inherit the creating user's ACL by default — only processes running as the same user can connect.

### Authentication: Shared Bearer Token

At startup, the CxMS service generates a random bearer token and writes it to a known file:

```
~/.phaibel/auth-token    (mode 0600, owner-read-only)
```

All clients (Phaibel, World Model Synthesizer, MCP inspector) read this file and include the token in every request:

```
Authorization: Bearer <token>
```

CxMS rejects any request without a valid token with `401 Unauthorized`.

**Token lifecycle:**
- Generated fresh on each CxMS start (crypto.randomBytes, 32 bytes, hex-encoded)
- Written atomically (write to `.auth-token.tmp`, rename to `auth-token`)
- Clients re-read the file if they receive a 401 (handles CxMS restarts)
- Token file deleted on clean shutdown

### Defense in depth

| Layer | Threat mitigated |
|-------|-----------------|
| Socket/pipe (not TCP) | Remote network access |
| File permissions (0600) | Other local users |
| Bearer token | Rogue processes running as same user |
| No `0.0.0.0` bind | Accidental network exposure |

### HTTP fallback

For debugging or environments where sockets are impractical, CxMS can optionally listen on `127.0.0.1:3838` (TCP, localhost only). The bearer token is still required. This mode is opt-in via `--tcp` flag:

```
cxms serve --foundation ~/vault --tcp --port 3838
```

Default (no flags) uses the socket.

---

## Open Questions

1. **Embedding API key** — CxMS needs an OpenAI key for semantic search. Pass via env var? Or make embeddings optional (keyword-only mode)?
2. **Foundation discovery** — Currently Phaibel walks up the directory tree to find `.phaibel.md`. CxMS should accept the root path explicitly (`--foundation <path>`).
3. **Multi-Foundation** — Could CxMS serve multiple Foundations on different path prefixes? Not needed now, but worth considering in the API design.
4. **Mobile app** — The Expo app currently imports entity functions in-process via the core bridge. After extraction, it would either bundle `@phaibel/cxms` directly (library mode) or connect to a running CxMS service. Library mode is simpler for mobile.
5. **FCP integration** — Federated Context Protocol currently lives in Phaibel. Should FCP move into CxMS (since it's about querying external context) or stay in Phaibel (since it's about federation across agents)?
