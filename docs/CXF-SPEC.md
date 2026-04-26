# Context Exchange Format (CXF/2)

**Version:** 2.0  
**Status:** Draft  
**MIME Type:** `application/ld+json`  
**File Extension:** `.cxf.json`  
**Authors:** Clift Labs / Phaibel  

---

## Abstract

**CXF (Context Exchange Format)** is a JSON-LD document format for exchanging typed context nodes and a labeled knowledge graph between systems. CXF/2 replaces the iCalendar-based CXF/1 transport with a clean JSON-LD wire format while preserving the full protocol (discovery, push/pull, incremental sync, tombstones).

A CXF/2 document is a valid JSON-LD `@graph` document using two namespaces:

- `cxf:` — `https://cxf.phaibel.ai/ns/` — CXF-specific properties
- `schema:` — `https://schema.org/` — standard vocabulary for common fields

The document is self-describing: type schemas are embedded in `cxf:schemas`, the full entity graph is in `@graph`, and all protocol state is carried in HTTP headers.

---

## 1. Design Goals

1. **Self-describing.** `cxf:schemas` tells consumers the field types and constraints for every custom type. No out-of-band registry required.
2. **Graph-native.** Links between nodes are first-class. Every node carries `cxf:links` (entity edges) and `cxf:attendees` (person edges). The full knowledge graph is reconstructable from a single document.
3. **Any type.** User-defined context types (recipe, flight, medication, vehicle) travel as `cxf:Context` nodes without format changes.
4. **Standard vocabulary.** Common fields (`name`, `description`, `startDate`, `keywords`, etc.) use `schema.org` predicates for interoperability with JSON-LD tooling.
5. **Native values.** Status and priority are stored as-is — no lossy ICS mapping round-trips.

---

## 2. Document Structure

A CXF/2 document is a JSON object with these top-level keys:

```json
{
  "@context": { "cxf": "https://cxf.phaibel.ai/ns/", "schema": "https://schema.org/" },
  "cxf:version": "2",
  "cxf:vaultId": "<stable vault identifier>",
  "cxf:exportTime": 1745222400,
  "cxf:ownerName": "<vault owner name>",
  "cxf:ownerEmail": "<owner email — omit if private>",
  "cxf:schemas": [ ... ],
  "@graph": [ ... ]
}
```

### 2.1 Envelope Fields

| Field | Required | Description |
|---|---|---|
| `@context` | yes | JSON-LD context declaring `cxf:` and `schema:` namespaces |
| `cxf:version` | yes | Format version. Must be `"2"` for this spec. |
| `cxf:vaultId` | yes | Stable opaque identifier for the source vault. Consumers use this to namespace entity IDs. |
| `cxf:exportTime` | yes | Unix timestamp (seconds) of export. Used as the `since` cursor for incremental sync. |
| `cxf:ownerName` | no | Human-readable vault owner name. |
| `cxf:ownerEmail` | no | Owner email. Omit if the producer treats it as private. |
| `cxf:schemas` | no | Array of `cxf:TypeSchema` objects. Present when `include_schema=true` (default). |
| `@graph` | yes | Array of entity nodes. May be empty. |

---

## 3. Entity Nodes

Every entity in `@graph` has this structure:

```json
{
  "@id": "urn:cxf:{vaultId}:{entityId}",
  "@type": "cxf:Task | cxf:Event | cxf:Note | cxf:Context",
  "cxf:nativeType": "{original type slug}",
  "schema:name": "{title}",
  "schema:description": "{markdown body — optional}",
  "schema:dateCreated": "{ISO-8601}",
  "schema:dateModified": "{ISO-8601}",
  "schema:keywords": ["{tag}", "..."],
  "cxf:status": "{native status value}",
  "cxf:priority": "{native priority value}",
  "cxf:archived": false,
  "cxf:deleted": false,
  "cxf:attendees": [ ... ],
  "cxf:links": [ ... ],
  "cxf:fields": { ... }
}
```

### 3.1 Universal Node Properties

| Property | Required | Description |
|---|---|---|
| `@id` | yes | `urn:cxf:{vaultId}:{entityId}` — globally unique, stable across exports |
| `@type` | yes | JSON-LD type. One of `cxf:Task`, `cxf:Event`, `cxf:Note`, `cxf:Context` |
| `cxf:nativeType` | yes | The original Phaibel type slug (e.g. `task`, `goal`, `todont`, `person`, `client`) |
| `schema:name` | yes | Entity title |
| `schema:description` | no | Markdown body content |
| `schema:dateCreated` | no | ISO-8601 creation timestamp |
| `schema:dateModified` | no | ISO-8601 last modification timestamp. Used for incremental sync. |
| `schema:keywords` | no | Array of tag strings |
| `cxf:archived` | yes | Boolean. `true` if the entity has been archived (soft-deleted) |
| `cxf:deleted` | yes | Boolean. `true` if the entity has been hard-deleted (tombstone) |
| `cxf:status` | no | Native status value (e.g. `open`, `in-progress`, `done`, `blocked`, `active`) |
| `cxf:priority` | no | Native priority value (e.g. `low`, `medium`, `high`, `critical`) |
| `cxf:attendees` | no | Array of person-link objects. Present when `include_graph=true` and person links exist. |
| `cxf:links` | no | Array of entity edge objects. Present when `include_graph=true` and non-person links exist. |
| `cxf:fields` | no | Object of custom type fields not mapped to a standard property. |

### 3.2 Type-Specific Properties

**Tasks and goals** (`cxf:Task`):

| Property | Description |
|---|---|
| `schema:dueDate` | Due date as ISO date string (`YYYY-MM-DD`) |
| `schema:startDate` | Start date |

**Events** (`cxf:Event`):

| Property | Description |
|---|---|
| `schema:startDate` | Event start as ISO datetime |
| `schema:endDate` | Event end as ISO datetime |
| `schema:duration` | ISO-8601 duration (e.g. `PT1H30M`) |
| `schema:location` | Location string |

**Notes** (`cxf:Note`):

No additional properties beyond the universal set.

**Custom types** (`cxf:Context`):

Custom fields appear in `cxf:fields`. All standard date/time fields are still mapped to `schema:` properties when present.

### 3.3 Type Routing Rules

Producers MUST apply this routing when serialising a context node:

| `cxf:nativeType` | `@type` |
|---|---|
| `event` | `cxf:Event` |
| `task` | `cxf:Task` |
| `goal` | `cxf:Task` |
| `todont` | `cxf:Task` |
| `note` | `cxf:Note` |
| all other types | `cxf:Context` |

Consumers MUST check `cxf:nativeType` alongside `@type` to discriminate between `task`, `goal`, and `todont` — all three share the `cxf:Task` JSON-LD type.

---

## 4. People as Attendees

When an entity has links to `person` entities, those links are resolved into the `cxf:attendees` array. Each entry:

```json
{
  "cxf:personId": "{person entity ID}",
  "cxf:role": "CHAIR | OPT-PARTICIPANT | NON-PARTICIPANT | REQ-PARTICIPANT",
  "schema:name": "{person display name}",
  "schema:email": "{email or id@cxf.local}"
}
```

**Role mapping from link label:**

| Link label | Role |
|---|---|
| `assigned-to`, `owner`, `responsible`, `lead` | `CHAIR` |
| `team-member`, `participant`, `player`, `member`, `attendee` | `REQ-PARTICIPANT` |
| `invited`, `optional` | `OPT-PARTICIPANT` |
| `observer`, `cc`, `notify`, `watcher` | `NON-PARTICIPANT` |
| *(any other)* | `REQ-PARTICIPANT` |

**Email resolution:**
1. Use `meta.email` on the person entity if present.
2. Otherwise synthesize `{person_id}@cxf.local` as a stable placeholder.

Consumers MUST use `cxf:personId` as the canonical identity key, not the email. The `@cxf.local` suffix is a placeholder — it is not a real email.

---

## 5. Graph Edges

Non-person links appear in the `cxf:links` array. Each entry:

```json
{
  "cxf:label": "{relation label}",
  "cxf:target": "urn:cxf:{vaultId}:{entityId}"
}
```

`cxf:target` is the full URN of the referenced entity, using the same `urn:cxf:{vaultId}:{entityId}` format as `@id`.

### 5.1 Common Link Labels

| Label | Meaning |
|---|---|
| `relates-to` | General association |
| `contributes-to` | Source contributes toward target |
| `blocks` | Source is blocking target |
| `part-of` | Source is a component of target |
| `belongs-to` | Source belongs to target (e.g. task belongs to client) |

Any string is a valid label. Labels are case-sensitive.

### 5.2 Graph Reconstruction

A consumer builds the full graph by:
1. Indexing all nodes by `@id`.
2. For each node, iterating `cxf:links` entries.
3. Resolving `cxf:target` to a node in the index.
4. Creating a directed edge `(source) -[cxf:label]-> (target)`.

Person edges from `cxf:attendees` are similarly directed, keyed by `cxf:personId`.

The graph is directed. Producers emit edges from the perspective of the source entity. Consumers who need bidirectional traversal invert the edges in their own store.

---

## 6. Type Schemas

`cxf:schemas` is an array of type schema objects. Producers SHOULD include one schema per distinct `cxf:nativeType` that appears in `@graph`. Consumers use schemas to understand the meaning and type of entries in `cxf:fields`.

```json
{
  "@type": "cxf:TypeSchema",
  "cxf:typeName": "{type slug}",
  "cxf:plural": "{plural slug}",
  "cxf:description": "{optional human description}",
  "cxf:fields": [
    {
      "cxf:key": "{field key}",
      "cxf:type": "{field type}",
      "cxf:label": "{display label}",
      "cxf:required": false,
      "cxf:values": ["{enum value}", "..."],
      "cxf:targetType": "{referenced type slug}"
    }
  ]
}
```

### 6.1 Field Types

| `cxf:type` | Description |
|---|---|
| `text` | Free-form text |
| `number` | Numeric value |
| `boolean` | `true` or `false` |
| `date` | `YYYY-MM-DD` |
| `datetime` | ISO-8601 with UTC offset |
| `duration` | ISO-8601 duration (e.g. `PT1H30M`) |
| `time` | `HH:MM` time of day |
| `date-fixed` | Date anchored to a calendar date |
| `date-floating` | Date without timezone |
| `enum` | One of a fixed set declared in `cxf:values` |
| `array` | JSON array |
| `object` | JSON object |
| `reference` | Link to another entity of type `cxf:targetType` |

### 6.2 Example Schema

```json
{
  "@type": "cxf:TypeSchema",
  "cxf:typeName": "goal",
  "cxf:plural": "goals",
  "cxf:description": "Long-term aspirations and objectives",
  "cxf:fields": [
    {
      "cxf:key": "status",
      "cxf:type": "enum",
      "cxf:label": "Status",
      "cxf:required": true,
      "cxf:values": ["active", "achieved", "abandoned", "paused"]
    },
    {
      "cxf:key": "priority",
      "cxf:type": "enum",
      "cxf:label": "Priority",
      "cxf:values": ["low", "medium", "high", "critical"]
    },
    {
      "cxf:key": "target_date",
      "cxf:type": "date",
      "cxf:label": "Target Date"
    }
  ]
}
```

---

## 7. CRUD Lifecycle

CXF communicates the full lifecycle of every entity through `schema:dateModified` timestamps and two boolean flags. Consumers detect changes by requesting `?since={last_cursor}`.

### 7.1 Create and Update

A new entity appears in the next export after it is created. An updated entity appears in any incremental export where `schema:dateModified > since`. No special flag is needed — presence in the response with a newer `schema:dateModified` is the signal.

### 7.2 Archive (Soft Delete)

Archiving hides an entity from active use but preserves it in the vault. Consumers should move the entity to an archived/inactive state, not destroy it.

```json
{
  "cxf:archived": true
}
```

- Archived entities continue to appear in full exports unless the consumer passes `?exclude_archived=true`.
- Archived entities appear in incremental exports for the sync cycle when they were archived, then only in full exports.

### 7.3 Delete (Hard Delete)

A hard delete permanently removes an entity. Consumers MUST treat this as a destroy signal.

```json
{
  "cxf:deleted": true
}
```

- Deleted entities MUST appear in every incremental export until the producer's sync state confirms all registered consumers have received the tombstone (`lastSyncAt > deletedAt` for each consumer entry in `cxf-sync.json`).
- After that confirmation, the node MAY be omitted from all future exports.

### 7.4 State Summary

| Lifecycle event | `cxf:archived` | `cxf:deleted` | Consumer action |
|---|---|---|---|
| Created | `false` | `false` | Upsert |
| Updated | `false` | `false` | Upsert |
| Archived | `true` | `false` | Soft delete / move to archive |
| Restored from archive | `false` | `false` | Upsert (re-activate) |
| Hard deleted | `false` | `true` | Destroy |

Producers MUST NOT set both `cxf:archived` and `cxf:deleted` to `true` on the same node.

---

## 8. Transport — The CXF Endpoint

A producer exposes a single HTTP endpoint:

```
GET /api/cxf
Content-Type: application/ld+json; charset=utf-8
```

### 8.1 Query Parameters

| Parameter | Description | Example |
|---|---|---|
| `types` | Comma-separated type slugs (matches `cxf:nativeType`). Default: all. | `types=task,goal,event` |
| `since` | Unix timestamp (seconds). Returns only nodes with `schema:dateModified ≥ since`. | `since=1745222400` |
| `consumer` | Opaque consumer identifier. When provided, the producer records the sync time. | `consumer=cos-01` |
| `include_schema` | `true` (default) or `false`. Whether to include `cxf:schemas`. | `include_schema=false` |
| `include_graph` | `true` (default) or `false`. Whether to include `cxf:attendees` and `cxf:links`. | `include_graph=false` |
| `exclude_archived` | `true` or `false` (default). Exclude archived entities. | `exclude_archived=true` |
| `tags` | Comma-separated tags (AND filter). | `tags=work,urgent` |

### 8.2 Response Headers

```
Content-Type: application/ld+json; charset=utf-8
X-CXF-Export-Time: 1745222400
X-CXF-Entity-Count: 214
X-CXF-Schema-Count: 8
```

`X-CXF-Export-Time` is a Unix timestamp (seconds). Consumers MUST use this value — not their own clock — as the `since` cursor for the next request. This prevents missed updates due to clock skew.

### 8.3 Producer Sync State

The producer tracks the last successful sync time per consumer in `.phaibel/cxf-sync.json`:

```json
{
  "consumers": {
    "cos-01": {
      "lastSyncAt": 1745222400,
      "firstSyncAt": 1744617600,
      "syncCount": 47
    }
  }
}
```

When a request includes `?consumer={id}`, the producer:
1. Records the current Unix timestamp as `lastSyncAt` for that consumer on successful response.
2. Sets `firstSyncAt` on the first request from that consumer.
3. Increments `syncCount`.

This state is used for tombstone management (§7.3): a deleted entity must be included in every export until `lastSyncAt > deletedAt` for all registered consumers, after which it may be dropped.

### 8.4 Incremental Sync Pattern

```
1. First run:    GET /api/cxf?consumer=cos-01
                 → full export; use X-CXF-Export-Time as cursor

2. Subsequent:   GET /api/cxf?since=1745222400&consumer=cos-01
                 → only nodes changed since that timestamp; use new X-CXF-Export-Time

3. For each node in @graph:
   a. Extract @id → parse urn:cxf:{vaultId}:{entityId}
   b. Check schema:dateModified vs stored; skip if unchanged
   c. Check cxf:deleted — if true, destroy record and skip
   d. Check cxf:archived — if true, soft-delete/archive record and skip
   e. Route by cxf:nativeType → correct context type
   f. Read cxf:fields using cxf:schemas for type information
   g. Read cxf:attendees → resolve/upsert people by cxf:personId
   h. Read cxf:links → upsert graph edges
   i. Upsert node record (re-activate if previously archived)
```

---

## 9. Versioning and Compatibility

- `cxf:version: "2"` is the current version.
- Consumers MUST ignore unknown `cxf:` properties (forward compatibility).
- Consumers MUST ignore unknown `@type` values they cannot process.
- Producers MUST NOT remove properties defined in this spec without a version bump.
- Future versions will use `cxf:version: "3"`, etc. Consumers SHOULD reject documents with versions they do not support.

---

## 10. Full Worked Example

A vault with five entities and a knowledge graph:

```json
{
  "@context": {
    "cxf": "https://cxf.phaibel.ai/ns/",
    "schema": "https://schema.org/"
  },
  "cxf:version": "2",
  "cxf:vaultId": "vault-gary-clift-01",
  "cxf:exportTime": 1745480400,
  "cxf:ownerName": "Gary Clift",
  "cxf:ownerEmail": "gary@clift-labs.com",
  "cxf:schemas": [
    {
      "@type": "cxf:TypeSchema",
      "cxf:typeName": "goal",
      "cxf:plural": "goals",
      "cxf:description": "Long-term aspirations and objectives",
      "cxf:fields": [
        { "cxf:key": "status", "cxf:type": "enum", "cxf:label": "Status",
          "cxf:values": ["active", "achieved", "abandoned", "paused"] },
        { "cxf:key": "priority", "cxf:type": "enum", "cxf:label": "Priority",
          "cxf:values": ["low", "medium", "high", "critical"] }
      ]
    },
    {
      "@type": "cxf:TypeSchema",
      "cxf:typeName": "todont",
      "cxf:plural": "todonts",
      "cxf:description": "Things to deliberately NOT do",
      "cxf:fields": [
        { "cxf:key": "reason", "cxf:type": "text", "cxf:label": "Reason" }
      ]
    }
  ],
  "@graph": [
    {
      "@id": "urn:cxf:vault-gary-clift-01:task-review-bob-a1b2",
      "@type": "cxf:Task",
      "cxf:nativeType": "task",
      "schema:name": "Review Bob's performance",
      "schema:description": "Prepare constructive feedback for Bob's Q2 review.\n\nKey themes: delivery consistency, communication across teams.",
      "schema:dueDate": "2026-04-30",
      "cxf:status": "open",
      "cxf:priority": "high",
      "schema:dateCreated": "2026-04-10T09:00:00Z",
      "schema:dateModified": "2026-04-20T14:00:00Z",
      "schema:keywords": ["hr", "management", "q2"],
      "cxf:archived": false,
      "cxf:deleted": false,
      "cxf:attendees": [
        {
          "cxf:personId": "person-bob-smith-c3d4",
          "cxf:role": "CHAIR",
          "schema:name": "Bob Smith",
          "schema:email": "bob@acme.com"
        }
      ],
      "cxf:links": [
        {
          "cxf:label": "relates-to",
          "cxf:target": "urn:cxf:vault-gary-clift-01:goal-great-team-e5f6"
        }
      ]
    },
    {
      "@id": "urn:cxf:vault-gary-clift-01:goal-great-team-e5f6",
      "@type": "cxf:Task",
      "cxf:nativeType": "goal",
      "schema:name": "Build a great engineering team",
      "schema:description": "Focus on hiring, culture, growth paths, and reducing attrition.",
      "cxf:archived": false,
      "cxf:deleted": false,
      "schema:dateCreated": "2026-01-01T00:00:00Z",
      "schema:dateModified": "2026-04-15T10:00:00Z",
      "schema:keywords": ["leadership", "hiring", "annual"],
      "cxf:fields": {
        "status": "active",
        "priority": "high"
      }
    },
    {
      "@id": "urn:cxf:vault-gary-clift-01:event-soccer-u12-g7h8",
      "@type": "cxf:Event",
      "cxf:nativeType": "event",
      "schema:name": "Under-12 Soccer Match vs Westside",
      "schema:description": "Regular season match. Arrive 30 min early for warm-up.",
      "schema:startDate": "2026-04-25T14:00:00Z",
      "schema:duration": "PT1H30M",
      "schema:location": "Riverside Park, Field 3",
      "cxf:archived": false,
      "cxf:deleted": false,
      "schema:dateCreated": "2026-04-01T08:00:00Z",
      "schema:dateModified": "2026-04-18T09:00:00Z",
      "schema:keywords": ["family", "kids", "soccer"],
      "cxf:attendees": [
        {
          "cxf:personId": "person-jamie-torres-ab12",
          "cxf:role": "REQ-PARTICIPANT",
          "schema:name": "Jamie Torres",
          "schema:email": "person-jamie-torres-ab12@cxf.local"
        },
        {
          "cxf:personId": "person-sam-reeves-cd34",
          "cxf:role": "REQ-PARTICIPANT",
          "schema:name": "Sam Reeves",
          "schema:email": "person-sam-reeves-cd34@cxf.local"
        }
      ]
    },
    {
      "@id": "urn:cxf:vault-gary-clift-01:todont-micromanage-i9j0",
      "@type": "cxf:Task",
      "cxf:nativeType": "todont",
      "schema:name": "Don't micromanage delivery timelines",
      "schema:description": "Reduces team autonomy and signals distrust. Coach instead.",
      "cxf:status": "in-progress",
      "cxf:archived": false,
      "cxf:deleted": false,
      "schema:dateCreated": "2026-02-10T09:00:00Z",
      "schema:dateModified": "2026-02-10T09:00:00Z",
      "schema:keywords": ["leadership", "behaviour"],
      "cxf:fields": {
        "reason": "Kills team autonomy and slows delivery velocity."
      },
      "cxf:links": [
        {
          "cxf:label": "relates-to",
          "cxf:target": "urn:cxf:vault-gary-clift-01:goal-great-team-e5f6"
        }
      ]
    },
    {
      "@id": "urn:cxf:vault-gary-clift-01:note-q3-strategy-k1l2",
      "@type": "cxf:Note",
      "cxf:nativeType": "note",
      "schema:name": "Thoughts on Q3 strategy",
      "schema:description": "## Q3 Direction\n\nFocus on consolidation over new features. Three themes:\n\n1. Team stability\n2. Technical debt\n3. Customer retention",
      "cxf:archived": false,
      "cxf:deleted": false,
      "schema:dateCreated": "2026-04-18T11:00:00Z",
      "schema:dateModified": "2026-04-18T11:30:00Z",
      "schema:keywords": ["strategy", "q3", "planning"],
      "cxf:links": [
        {
          "cxf:label": "relates-to",
          "cxf:target": "urn:cxf:vault-gary-clift-01:goal-great-team-e5f6"
        }
      ]
    }
  ]
}
```

---

## 11. Parser Implementation Guide

### Minimum viable CXF/2 parser

```
1. Parse the JSON document.
2. Verify cxf:version === "2"; reject otherwise.
3. Extract cxf:schemas → build type schema registry keyed by cxf:typeName.
4. For each node in @graph:
   a. Read @id → split "urn:cxf:{vaultId}:{entityId}"
   b. Read cxf:nativeType → look up schema in registry
   c. Read cxf:deleted — if true, destroy record and skip
   d. Read cxf:archived — if true, soft-delete/archive record and skip
   e. Read schema:dateModified → compare to stored; skip if unchanged
   f. Read cxf:attendees → build person records (key: cxf:personId)
   g. Read cxf:fields → apply schema types for casting
   h. Read cxf:links → store as directed graph edges
5. Upsert all records and edges.
6. Record X-CXF-Export-Time response header (Unix seconds) as the new cursor.
```

### Edge Cases

- **Missing `cxf:schemas`:** Treat all `cxf:fields` values as their JSON native types.
- **Unknown `cxf:nativeType`:** Store as generic `cxf:Context` without type-specific processing.
- **Circular links:** Valid. The graph may have cycles. Consumers must handle cycles in traversal.
- **Missing `schema:email` on attendee:** Use `cxf:personId` as the identity key; synthesize `{personId}@cxf.local` as a display placeholder.
- **Tombstone nodes:** A node with `cxf:deleted: true` may have minimal fields (`@id`, `schema:name`, `schema:dateModified`). The only required action is to destroy the corresponding record.

---

## 12. Relationship to FCP

CXF and FCP are complementary:

| | FCP | CXF |
|---|---|---|
| **Transport** | HTTP probe/fetch | HTTP GET (pull) |
| **Format** | JSON | JSON-LD |
| **Primary use** | Real-time query-driven context retrieval | Bulk export / sync |
| **Graph** | Via `links[]` in fetch response | Via `cxf:links` + `cxf:attendees` |
| **Schema** | Discovered via `/fcp/manifest` | Embedded as `cxf:schemas` |
| **Incremental** | Via `keywords` + `time_range` | Via `?since={unix_seconds}` cursor |
| **Best for** | Chat-time context retrieval | ETL, backup, bulk import |

A system can implement both. FCP is the real-time read protocol; CXF is the bulk exchange format.

---

## 13. Conformance

A producer is CXF/2 conformant if:

1. Every produced document contains `"cxf:version": "2"`.
2. Every node in `@graph` carries `@id`, `@type`, `cxf:nativeType`, `schema:name`, `cxf:archived`, and `cxf:deleted`.
3. `@id` follows the `urn:cxf:{vaultId}:{entityId}` format.
4. Type routing rules in §3.3 are respected.
5. `cxf:schemas` is present for every distinct `cxf:nativeType` in the document when `include_schema=true`.
6. `cxf:personId` is present on every `cxf:attendees` entry.
7. `cxf:deleted: true` nodes are emitted in every incremental export until all registered consumers have acknowledged the deletion via `cxf-sync.json`.
8. `cxf:archived` and `cxf:deleted` are never both `true` on the same node.
9. The document is valid JSON parseable by any standard JSON library.

---

## Appendix A — Reserved `cxf:` Property Names

### Envelope

| Property | Description |
|---|---|
| `cxf:version` | Format version (`"2"`) |
| `cxf:vaultId` | Stable vault identifier |
| `cxf:exportTime` | Export timestamp (Unix seconds) |
| `cxf:ownerName` | Vault owner name |
| `cxf:ownerEmail` | Vault owner email |
| `cxf:schemas` | Array of type schema objects |

### Node

| Property | Description |
|---|---|
| `cxf:nativeType` | Original type slug |
| `cxf:status` | Native status value |
| `cxf:priority` | Native priority value |
| `cxf:archived` | Soft delete flag (boolean) |
| `cxf:deleted` | Hard delete / tombstone flag (boolean) |
| `cxf:attendees` | Array of person-link objects |
| `cxf:links` | Array of entity edge objects |
| `cxf:fields` | Object of custom type fields |

### Attendee

| Property | Description |
|---|---|
| `cxf:personId` | Person entity ID (canonical identity key) |
| `cxf:role` | Role (`CHAIR`, `REQ-PARTICIPANT`, `OPT-PARTICIPANT`, `NON-PARTICIPANT`) |

### Link

| Property | Description |
|---|---|
| `cxf:label` | Relationship label |
| `cxf:target` | Target node URN (`urn:cxf:{vaultId}:{entityId}`) |

### Schema (`cxf:TypeSchema`)

| Property | Description |
|---|---|
| `cxf:typeName` | Type slug |
| `cxf:plural` | Plural slug |
| `cxf:description` | Human description |
| `cxf:fields` | Array of field definition objects |

### Field Definition

| Property | Description |
|---|---|
| `cxf:key` | Field key |
| `cxf:type` | Field type (see §6.1) |
| `cxf:label` | Display label |
| `cxf:required` | Boolean |
| `cxf:values` | Array of enum values |
| `cxf:targetType` | Referenced type slug (for `reference` fields) |

---

## Appendix B — Change Log

| Version | Date | Notes |
|---|---|---|
| 1.0 | 2026-04-21 | Initial draft — iCalendar/RFC 5545 transport |
| 2.0 | 2026-04-25 | Transport rewritten as JSON-LD; removed VCALENDAR/VSCHEMA/VCONTEXT/VTODO/VEVENT/VJOURNAL; native status/priority values; `cxf:` and `schema:` namespaces |
