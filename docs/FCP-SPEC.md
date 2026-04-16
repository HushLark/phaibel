# Federated Context Protocol (FCP)

**Version:** 1.0
**Status:** Draft
**Authors:** Clift Labs / Phaibel
**Contact:** support@phaibel.dev

FCP is a narrow HTTP + JSON protocol that lets an AI agent query context from
many independent sources without blowing up its token budget. It is
**deliberately small** — two operational verbs plus one discovery endpoint.
Any vendor that implements the three endpoints below can be federated into a
Phaibel-compatible agent.

---

## 1. Design Goals

1. **Probe-then-fetch.** Never send bodies until the agent asks for specific IDs. This keeps probe responses cheap and cacheable.
2. **One envelope.** Every request/response declares `fcp_version` and includes an `actor`. No versioning on individual endpoints.
3. **Source decides what to share.** The source, not the client, enforces ACLs. The client only advises (via `actor`, `purpose`, `scopes`).
4. **Fail soft.** A slow or down source should never block the agent. Clients budget every call.
5. **No streaming in v1.** All responses are single JSON documents. Streaming may be added in v2 via `Accept: text/event-stream`.

---

## 2. Endpoints

All endpoints live under a single base URL that the vendor publishes, e.g.:
```
https://context.example.com/fcp
```

| Verb   | Path                | Purpose |
|--------|---------------------|---------|
| GET    | `/fcp/manifest`     | Discovery — what does this source expose? |
| POST   | `/fcp/probe`        | Initial Context Query (counts + sample titles) |
| POST   | `/fcp/fetch`        | Full Context Query (full bodies for specific IDs) |

Content type: `application/json; charset=utf-8`.
Errors: [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457) (`application/problem+json`).

---

## 3. Core Types

### 3.1 Actor

Every request body carries an `actor` object identifying the caller.

```json
{
  "agent_id": "phaibel:gary@clift-labs",
  "signature": "ed25519:base64...",
  "pubkey": "base64..."
}
```

| Field        | Type   | Required | Description |
|--------------|--------|----------|-------------|
| `agent_id`   | string | yes      | Stable identifier, scheme-prefixed (`phaibel:`, `openai:`, `custom:`) |
| `signature`  | string | no       | Ed25519 signature of the canonical request body, base64 |
| `pubkey`     | string | no       | Public key (for peer sources without pre-registration) |

Sources MAY reject requests where signature verification fails, but MUST accept
unsigned requests from bearer-token-authenticated clients.

### 3.2 Trust Tiers

A source declares its own trust tier in `manifest.trust`, but the **client**
assigns the effective tier locally.

| Tier     | Meaning |
|----------|---------|
| `own`    | The agent's own data. Full content, no filtering. |
| `team`   | Organization-controlled (Notion, Linear, internal). Full content with audit. |
| `peer`   | Another agent's vault. Summaries only unless co-signed. |
| `public` | Public corpus (docs, wikis). Always cite. |

Sources SHOULD return `summary` only (no `body`) when responding to `peer`-tier
actors with `detail: "summary"`.

---

## 4. GET /fcp/manifest

Discovery. No authentication required, though sources MAY require a bearer
token to reveal detailed scopes.

**Request:** none.

**Response 200:**
```json
{
  "fcp_version": 1,
  "source": "notion:team-workspace",
  "name": "Acme Notion",
  "entity_types": ["page", "database_row", "person"],
  "scopes": ["page", "person"],
  "auth_methods": ["bearer"],
  "trust": "team",
  "contact": "ops@acme.com"
}
```

| Field          | Type     | Required | Description |
|----------------|----------|----------|-------------|
| `fcp_version`  | integer  | yes      | Must be `1` |
| `source`       | string   | yes      | Stable source ID (must match `source` in probe/fetch responses) |
| `name`         | string   | yes      | Human-readable |
| `entity_types` | string[] | yes      | All types this source knows about |
| `scopes`       | string[] | yes      | Types callers may request; subset of `entity_types` |
| `auth_methods` | string[] | yes      | Any of `"bearer"`, `"signed"`, `"none"` |
| `trust`        | string   | yes      | One of `own \| team \| peer \| public` |
| `contact`      | string   | no       | Support email / URL |

---

## 5. POST /fcp/probe — Initial Context Query

Returns **counts and sample titles only**. Never bodies. This is the
performance-critical call — design it to respond in <500ms and be aggressively
cacheable.

### 5.1 Request

```json
{
  "fcp_version": 1,
  "query": {
    "keywords": ["bob", "preparation", "1:1"],
    "hints": { "entity_types": ["person", "doc"] },
    "time_range": { "from": "2026-04-01", "to": "2026-04-30" }
  },
  "actor": { "agent_id": "phaibel:gary@clift-labs" },
  "budget": {
    "max_latency_ms": 500,
    "max_matches_per_type": 5
  }
}
```

| Field                          | Type      | Required | Description |
|--------------------------------|-----------|----------|-------------|
| `fcp_version`                  | integer   | yes      | Must be `1` |
| `query.keywords`               | string[]  | yes      | 1–32 terms. Stop words already removed. |
| `query.hints.entity_types`     | string[]  | no       | Narrow to these types |
| `query.time_range.from`/`.to`  | ISO date  | no       | Filter by entity time |
| `actor`                        | object    | yes      | See §3.1 |
| `budget.max_latency_ms`        | integer   | no       | Soft deadline. Default `500` |
| `budget.max_matches_per_type`  | integer   | no       | Cap sample titles per type. Default `5` |

### 5.2 Response 200

```json
{
  "fcp_version": 1,
  "source": "notion:team-workspace",
  "source_trust": "team",
  "probed_at": "2026-04-16T10:15:00Z",
  "ttl_seconds": 300,
  "matches": [
    {
      "type": "person",
      "count": 1,
      "samples": [
        { "id": "p-42", "title": "Bob Smith", "score": 0.94 }
      ]
    },
    {
      "type": "doc",
      "count": 3,
      "samples": [
        { "id": "d-11", "title": "Bob 1:1 template", "score": 0.88 },
        { "id": "d-17", "title": "Bob's Q2 notes",   "score": 0.72 }
      ]
    }
  ],
  "token_estimate": { "probe": 180, "fetch_full": 4200 }
}
```

| Field              | Type    | Required | Description |
|--------------------|---------|----------|-------------|
| `fcp_version`      | integer | yes      | `1` |
| `source`           | string  | yes      | Matches `manifest.source` |
| `source_trust`     | string  | no       | Self-declared trust tier |
| `probed_at`        | string  | yes      | ISO-8601 timestamp |
| `ttl_seconds`      | integer | yes      | How long this result is safe to cache |
| `matches[].type`   | string  | yes      | Must be in `manifest.entity_types` |
| `matches[].count`  | integer | yes      | Total matching entities (may exceed `samples.length`) |
| `matches[].samples[].id`     | string | yes | Opaque ID, stable across calls |
| `matches[].samples[].title`  | string | yes | Short human label |
| `matches[].samples[].score`  | number | yes | Relevance, 0–1 |
| `token_estimate.probe`       | integer | no | Estimated tokens this response uses |
| `token_estimate.fetch_full`  | integer | no | Estimated tokens if the client fetches every match |

**Scoring** is source-specific but MUST be normalized to `[0, 1]`. Clients
only compare scores within the same source.

### 5.3 Errors

| Status | Title                  | Meaning |
|--------|------------------------|---------|
| 400    | Bad Request            | Malformed body or `fcp_version` mismatch |
| 401    | Unauthorized           | Missing/invalid auth |
| 403    | Forbidden              | Actor not allowed to probe this source |
| 429    | Too Many Requests      | Rate limited; `Retry-After` header SHOULD be set |

---

## 6. POST /fcp/fetch — Full Context Query

Returns full bodies for specific IDs previously surfaced by `/fcp/probe`.

### 6.1 Request

```json
{
  "fcp_version": 1,
  "ids": ["p-42", "d-11"],
  "detail": "full",
  "actor": { "agent_id": "phaibel:gary@clift-labs" },
  "purpose": "1:1 prep with Bob"
}
```

| Field         | Type     | Required | Description |
|---------------|----------|----------|-------------|
| `fcp_version` | integer  | yes      | `1` |
| `ids`         | string[] | yes      | 1–100 IDs from prior probe responses |
| `detail`      | string   | no       | `"summary"` or `"full"`. Default `"full"` |
| `actor`       | object   | yes      | See §3.1 |
| `purpose`     | string   | no       | ≤200 chars. Logged for audit — recommended for `team` tier |

### 6.2 Response 200

```json
{
  "fcp_version": 1,
  "source": "notion:team-workspace",
  "nodes": [
    {
      "id": "p-42",
      "type": "person",
      "title": "Bob Smith",
      "summary": "Staff eng, reports to Alice",
      "body": "…markdown or plain text…",
      "meta": { "last_interaction": "2026-04-09", "pronouns": "he/him" },
      "links": [
        { "type": "doc", "id": "d-11", "relation": "authored" }
      ]
    }
  ],
  "denied_ids": [],
  "truncated": false
}
```

| Field                | Type    | Required | Description |
|----------------------|---------|----------|-------------|
| `nodes[].id`         | string  | yes      | Matches a requested ID |
| `nodes[].type`       | string  | yes      | In `manifest.entity_types` |
| `nodes[].title`      | string  | yes      | |
| `nodes[].summary`    | string  | no       | Always present if `detail="summary"` |
| `nodes[].body`       | string  | no       | Present only if `detail="full"` and actor allowed |
| `nodes[].meta`       | object  | no       | Free-form structured metadata |
| `nodes[].links[]`    | array   | no       | Edges to other entities in *this* source |
| `denied_ids[]`       | string[]| yes      | IDs the actor was not allowed to see |
| `truncated`          | boolean | yes      | True if the response was cut short (client should retry with fewer IDs) |

### 6.3 Errors

Same set as §5.3.

---

## 7. Authentication

FCP does not mandate an auth scheme. Sources declare what they support in
`manifest.auth_methods`:

- **`bearer`** — Standard `Authorization: Bearer <token>` header. Tokens are
  out-of-band provisioned.
- **`signed`** — Ed25519 signature over the canonical JSON body, placed in
  `actor.signature`. Used for peer-to-peer Phaibels. Canonical form is
  RFC 8785 (JCS) of the request body, minus the `signature` field.
- **`none`** — Public source. Still SHOULD rate-limit by IP.

A source MAY require one, all, or any combination.

---

## 8. Caching

- `/fcp/manifest`: sources SHOULD send `Cache-Control: max-age=3600`.
- `/fcp/probe`: response includes `ttl_seconds`. Clients MUST NOT cache longer than this.
- `/fcp/fetch`: responses MUST NOT be cached across actors.

---

## 9. Rate Limits

Sources SHOULD enforce per-actor limits. Suggested defaults:

- `/fcp/probe`: 60 req/min per actor
- `/fcp/fetch`: 20 req/min per actor, 1000 total IDs/min

Return `429` with `Retry-After` header when exceeded.

---

## 10. Minimal Worked Example

A Phaibel agent asking *"What should I prepare for my 1:1 with Bob?"*

**Step 1 — Probe (parallel, to every configured source)**
```http
POST https://context.example.com/fcp/probe
Content-Type: application/json
Authorization: Bearer tok_xyz

{
  "fcp_version": 1,
  "query": { "keywords": ["bob", "1:1", "prepare"] },
  "actor": { "agent_id": "phaibel:gary@clift-labs" },
  "budget": { "max_latency_ms": 500 }
}
```
Response tells the agent Bob exists as a `person` (1 match) and there are 3
related `doc`s. No bodies pulled yet.

**Step 2 — Agent decides to fetch the person record + the 1:1 template**
```http
POST https://context.example.com/fcp/fetch
Content-Type: application/json
Authorization: Bearer tok_xyz

{
  "fcp_version": 1,
  "ids": ["p-42", "d-11"],
  "detail": "full",
  "actor": { "agent_id": "phaibel:gary@clift-labs" },
  "purpose": "1:1 prep"
}
```

**Step 3 — Agent synthesizes**
The agent has two blobs of text + its own vault context and produces the prep
notes. Total tokens spent on federation: the probe (~200) plus just the two
fetched bodies (~1,800) — vs. dumping every Bob-related doc (~15,000+).

---

## 11. Implementing a Source — Checklist

To make your product federatable:

1. **Expose `/fcp/manifest`** — list the entity types you want searchable.
2. **Implement `/fcp/probe`** — keyword search against titles/summaries, return counts + top samples. Do not load bodies.
3. **Implement `/fcp/fetch`** — load bodies for the given IDs, honoring per-actor ACLs.
4. **Pick an auth scheme** — bearer is easiest.
5. **Publish the base URL** so clients can register it.

A reference implementation in TypeScript (≈ 250 lines) is available at:
`phaibel/src/federation/fcp-server.ts` in the Phaibel repo.

---

## 12. Registering a Source with a Phaibel Client

The client stores sources in `{vault}/.phaibel/fcp-sources.json`:

```json
{
  "sources": [
    {
      "id": "notion:team-workspace",
      "url": "https://context.example.com/fcp",
      "trust": "team",
      "auth": { "type": "bearer", "token_ref": "notion" },
      "scopes": ["person", "doc"],
      "enabled": true
    }
  ]
}
```

`token_ref` is a key into the client's secrets store — never the literal token.

---

## 13. Conformance

A source is FCP/1.0 conformant if and only if:

1. `GET /fcp/manifest` returns a valid `Manifest`.
2. `POST /fcp/probe` with a valid request returns a valid `ProbeResponse` within the declared `max_latency_ms + 200ms`, or returns an RFC 9457 error.
3. `POST /fcp/fetch` with only IDs previously returned by its own probe returns a `FetchResponse` where every requested ID appears either in `nodes[].id` or `denied_ids[]`.
4. All responses declare `fcp_version: 1`.
5. No response containing `body` bypasses the source's ACL for the given `actor`.

A test suite (`fcp-conformance`) is planned — see the Phaibel repo for updates.

---

## 14. Change Log

| Version | Date       | Changes |
|---------|------------|---------|
| 1.0     | 2026-04-16 | Initial public draft |
