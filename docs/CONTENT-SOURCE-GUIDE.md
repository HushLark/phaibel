# How to Be a Content Source

**Audience:** Developers building a system (COS, a SaaS integration, another agent) that wants to make its data available to Phaibel.

A **content source** is any HTTP service that implements the Federated Context Protocol (FCP). Phaibel federates against one or more sources on every request that needs external context. Sources live alongside CxMS — Phaibel's primary store — and are queried in parallel using the same two-pass pattern CxMS uses internally.

The protocol reference is in [FCP-SPEC.md](./FCP-SPEC.md). This document is the practical guide: what the two passes actually do, how Phaibel uses the results, and what you need to build.

---

## Overview: The Two-Pass Model

Every context-gathering request Phaibel makes to a source follows the same two-step pattern:

```
Phaibel                         Your Source
   │                                 │
   │── POST /fcp/probe ─────────────>│  (1) Summary pass
   │<─ counts + titles ──────────────│      Fast. No bodies.
   │                                 │
   │  [Phaibel decides what to fetch]│
   │                                 │
   │── POST /fcp/fetch ─────────────>│  (2) Detail pass
   │<─ full nodes ───────────────────│      Targeted. Bodies included.
```

The two passes exist because **bodies are expensive** — in tokens, latency, and memory. Phaibel may probe a dozen sources in parallel for every user request. If each source dumped its full content on every probe, the token budget would be exhausted before the agent could do anything useful. The summary pass makes federation cheap; the detail pass makes it accurate.

---

## Pass 1 — The Summary Pass (`POST /fcp/probe`)

### What Phaibel sends

```json
{
  "fcp_version": 1,
  "query": {
    "keywords": ["bob", "1:1", "performance"],
    "hints": { "entity_types": ["person", "note"] },
    "time_range": { "from": "2026-03-01", "to": "2026-04-30" }
  },
  "actor": { "agent_id": "phaibel:gary@clift-labs" },
  "budget": {
    "max_latency_ms": 500,
    "max_matches_per_type": 5
  }
}
```

- `keywords` are already stop-word-stripped by Phaibel — treat them as AND/OR search terms, not a sentence.
- `hints.entity_types` is advisory — the source can return other types, but should prioritise these.
- `time_range` is advisory — honour it if your data has timestamps.
- `budget.max_latency_ms` is a soft deadline. Exceed it and Phaibel may time you out and proceed without you.
- `budget.max_matches_per_type` caps how many sample titles you return **per type** — not the total count.

### What you return

```json
{
  "fcp_version": 1,
  "source": "cos:gary@clift-labs",
  "source_trust": "own",
  "probed_at": "2026-04-20T14:22:00Z",
  "ttl_seconds": 120,
  "matches": [
    {
      "type": "person",
      "count": 1,
      "samples": [
        { "id": "person-bob-smith", "title": "Bob Smith", "score": 0.95 }
      ]
    },
    {
      "type": "thread",
      "count": 4,
      "samples": [
        { "id": "thread-a1b2", "title": "Bob — performance concern (Apr 14)", "score": 0.88 },
        { "id": "thread-c3d4", "title": "1:1 agenda with Bob (Apr 7)",        "score": 0.81 }
      ]
    }
  ],
  "token_estimate": { "probe": 220, "fetch_full": 5800 }
}
```

**The critical rules:**

1. **Never return bodies here.** Titles and IDs only. If you're tempted to include a summary field in probe samples, don't — that belongs in the fetch response.
2. **Return `count` honestly.** If you have 47 matching threads but only return 5 samples, say `"count": 47`. Phaibel uses the count to decide whether to fetch more.
3. **Score relative to your own results.** `score` is normalised `[0, 1]` within your source. Phaibel does not compare scores across sources.
4. **Set `ttl_seconds` sensibly.** Phaibel may re-use this probe response for repeat queries within the TTL without hitting you again. Real-time sources (email inbox) use low TTLs (30–60s). Stable data (employee directory) can use high TTLs (3600s+).
5. **Respond fast.** Target <200ms. Never exceed `max_latency_ms`. If your data store is slow, maintain a lightweight search index (inverted index over titles and tags is sufficient).

### What Phaibel does with it

After probing all configured sources in parallel, Phaibel has a ranked list of `(source, type, id, title, score)` tuples. It then decides which IDs are worth the cost of fetching — typically the top-scoring samples from the highest-trust sources — and moves to the detail pass.

Probes with zero matches are silently discarded. A source that consistently returns zero matches for a user's typical queries will accumulate a poor relevance score internally and be deprioritised.

---

## Pass 2 — The Detail Pass (`POST /fcp/fetch`)

### What Phaibel sends

```json
{
  "fcp_version": 1,
  "ids": ["person-bob-smith", "thread-a1b2"],
  "detail": "full",
  "actor": { "agent_id": "phaibel:gary@clift-labs" },
  "purpose": "1:1 prep with Bob"
}
```

- `ids` are exactly the IDs you returned in your probe samples. They must be stable — the same entity should always have the same ID.
- `detail` is either `"summary"` (short description, no body) or `"full"` (complete content). Phaibel sends `"full"` unless token budget is tight.
- `purpose` is a free-text audit hint. Log it. It tells you why Phaibel asked.

### What you return

```json
{
  "fcp_version": 1,
  "source": "cos:gary@clift-labs",
  "nodes": [
    {
      "id": "person-bob-smith",
      "type": "person",
      "title": "Bob Smith",
      "summary": "Staff engineer, reports to Alice Chen. Flagged for performance concern in April cycle.",
      "body": "## Bob Smith\n\n**Role:** Staff Engineer, Platform team\n**Manager:** Alice Chen\n**Tenure:** 3.5 years\n\n### Notes\n- April performance review flagged consistency issues\n- Strong technically, struggles with cross-team communication\n- Last 1:1: April 7 — discussed Q2 goals\n",
      "meta": {
        "email": "bob@acme.com",
        "last_interaction": "2026-04-14",
        "sentiment": "neutral"
      },
      "links": [
        { "type": "thread", "id": "thread-a1b2", "relation": "subject-of" },
        { "type": "thread", "id": "thread-c3d4", "relation": "subject-of" }
      ]
    },
    {
      "id": "thread-a1b2",
      "type": "thread",
      "title": "Bob — performance concern (Apr 14)",
      "summary": "Email thread flagging Bob's missed deliverable on the infra migration.",
      "body": "**From:** Alice Chen\n**Date:** April 14\n\nHey, wanted a quick sync on Bob's infra migration deliverable — he missed the Apr 11 checkpoint...",
      "meta": {
        "source_system": "gmail",
        "participants": ["alice@acme.com", "gary@acme.com"],
        "date": "2026-04-14"
      },
      "links": [
        { "type": "person", "id": "person-bob-smith", "relation": "about" }
      ]
    }
  ],
  "denied_ids": [],
  "truncated": false
}
```

**The critical rules:**

1. **Always include `summary`** even when `detail` is `"full"`. Phaibel may choose to use the summary instead of the body in certain prompt positions to save tokens.
2. **`body` is optional when `detail` is `"summary"`.** If `detail` is `"full"`, you should include `body` unless ACL denies it.
3. **Denied IDs go in `denied_ids`, not missing from `nodes`.** If Phaibel asked for 5 IDs and you could only return 4, the 5th must be listed in `denied_ids`. This is how Phaibel knows the ID was valid but access was denied, vs. the ID being invalid.
4. **`links` are intra-source only.** Only reference IDs that exist within your own source. Cross-source links are not supported in FCP v1.
5. **`meta` is free-form.** Include any structured fields that an LLM would find useful (dates, authors, status, sentiment). Keep keys short and values serialisable.
6. **`truncated: true` if you had to cut the response.** If `ids` contained 100 items and you could only fully render 40, return `"truncated": true`. Phaibel will retry with a smaller batch.

---

## The Manifest (`GET /fcp/manifest`)

This is a discovery endpoint. Phaibel hits it once (and caches) to learn what you expose.

```json
{
  "fcp_version": 1,
  "source": "cos:gary@clift-labs",
  "name": "Chief of Staff (COS)",
  "entity_types": ["person", "thread", "task", "decision", "signal"],
  "scopes":       ["person", "thread", "task", "decision", "signal"],
  "auth_methods": ["bearer"],
  "trust": "own",
  "contact": "gary@clift-labs.com"
}
```

Keep `entity_types` accurate. Phaibel's Step 1 (catalog node selection) uses the manifest to decide which sources are worth probing for a given request type.

---

## Registering Your Source with Phaibel

Add an entry to `{vault}/.phaibel/fcp-sources.json`:

```json
{
  "sources": [
    {
      "id": "cos:gary@clift-labs",
      "url": "http://localhost:4000/fcp",
      "description": "Chief of Staff — email, Slack, and project signals",
      "mode": "read",
      "trust": "own",
      "auth": { "type": "bearer", "token_ref": "cos" },
      "scopes": [],
      "enabled": true
    }
  ]
}
```

`token_ref` is a key into `~/.phaibel/secrets.json`, not the literal token. `scopes: []` means probe all types.

---

## How CxMS Fits In

CxMS is Phaibel's primary content source and always registered as `trust: "own"`. It implements the same two-pass FCP contract internally. When you add a second source (COS, Notion, Linear), Phaibel probes all of them in parallel during Step 1 and merges results by relevance score, weighted by trust tier:

```
own  → full weight
team → 0.8×
peer → 0.5×  (summary-detail only)
public → 0.3×
```

This means COS data (trust: `own`) is treated as equally authoritative as CxMS data. A `person` node in COS carries the same weight as a `person` node in CxMS, and Phaibel may merge them if the titles match.

---

## Minimal Implementation Checklist

```
[ ] GET  /fcp/manifest  — return entity types and auth methods
[ ] POST /fcp/probe     — keyword search, titles only, <500ms
[ ] POST /fcp/fetch     — full nodes for given IDs
[ ] Bearer token auth   — validate Authorization header
[ ] Stable IDs          — same entity always returns the same ID
[ ] Honest counts       — count reflects total matches, not just samples
[ ] summary always set  — even when detail="full"
[ ] denied_ids populated — never silently drop an ID
```

A reference TypeScript implementation is at `src/federation/fcp-server.ts` in this repo. It is ~250 lines and implements all three endpoints against a CxMS-backed store.

---

## Summary Pass vs Detail Pass — Quick Reference

| Concern              | Summary Pass (`/probe`)      | Detail Pass (`/fetch`)         |
|----------------------|------------------------------|--------------------------------|
| **Purpose**          | Discover what exists         | Retrieve what's needed         |
| **Input**            | Keywords + hints + budget    | IDs from prior probe           |
| **Output**           | Counts + titles + scores     | Full nodes with body + meta    |
| **Bodies returned?** | Never                        | Yes (when `detail="full"`)     |
| **Latency target**   | <200ms                       | <1000ms                        |
| **Cacheable?**       | Yes, per `ttl_seconds`       | No (actor-specific)            |
| **Called how often** | Every relevant request       | Only for top-ranked IDs        |
| **Token cost**       | Low (~100–300 tokens)        | Variable (depends on content)  |
