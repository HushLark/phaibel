# Context Exchange Format (CXF/1)

**Version:** 1.0  
**Status:** Draft  
**Extends:** iCalendar RFC 5545  
**MIME Type:** `text/cxf`  
**File Extension:** `.cxf`  
**Authors:** Clift Labs / Phaibel  

---

## Abstract

**CXF (Context Exchange Format)** is a superset of iCalendar (RFC 5545) that extends it to carry any typed context node and a typed, labeled knowledge graph. A CXF document is valid iCalendar: legacy calendar clients silently skip the new components; CXF-aware consumers get the full graph.

CXF adds three things iCalendar does not have:

1. **`VSCHEMA`** — declares the field schema for a context type so consumers can interpret custom data without out-of-band coordination.
2. **`VCONTEXT`** — carries an instance of any context type that is not natively a VEVENT, VTODO, or VJOURNAL.
3. **`X-CXF-LINK`** — a property on every component that encodes a typed, labeled outbound edge to another component.

Standard iCalendar components (VEVENT, VTODO, VJOURNAL) are used for their native types and are extended with CXF properties. Everything else — goals, people, todonts, recipes, flights, any user-defined type — travels as VCONTEXT.

---

## 1. Design Goals

1. **RFC 5545 compatible.** Any CXF document is parseable by a standard iCalendar library. Unknown components and X- properties are silently skipped per §3.8.8.1 of RFC 5545.
2. **Self-describing.** VSCHEMA components tell consumers the field types and constraints for every VCONTEXT type in the document. No out-of-band schema registry required.
3. **Graph-native.** Links between nodes are first-class. Every component can declare outbound edges with a label. The full knowledge graph is reconstructable from a single CXF document.
4. **Any type.** User-defined context types (recipe, flight, medication, vehicle) travel as VCONTEXT without any schema changes in the format itself.
5. **Incrementally adoptable.** A producer can start with standard iCalendar and add CXF properties and components progressively.

---

## 2. Document Structure

A CXF document is a VCALENDAR block. The envelope carries producer identity, format version, and owner metadata. Inside it, components appear in this order (order is advisory, not required):

```
BEGIN:VCALENDAR
  [Envelope properties]
  [VSCHEMA blocks — one per context type]
  [VEVENT blocks]
  [VTODO blocks]
  [VJOURNAL blocks]
  [VCONTEXT blocks]
END:VCALENDAR
```

### 2.1 Envelope Properties

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Producer//Product Name//EN
X-CXF-VERSION:1
X-CXF-EXPORT-TIME:20260421T090000Z
X-CXF-VAULT-ID:{opaque stable identifier for the originating vault}
X-CXF-OWNER-NAME:{human name of the vault owner}
X-CXF-OWNER-EMAIL:{email — omit if private}
X-CXF-ENTITY-COUNT:{total number of components}
```

| Property | Required | Description |
|---|---|---|
| `VERSION` | yes | Must be `2.0` (RFC 5545) |
| `PRODID` | yes | RFC 5545 producer identifier |
| `X-CXF-VERSION` | yes | CXF version. Must be `1` for this spec. |
| `X-CXF-EXPORT-TIME` | yes | ISO-8601 UTC timestamp of export. Used as the `since` cursor for incremental sync. |
| `X-CXF-VAULT-ID` | yes | Stable opaque identifier for the source vault. Consumers use this to namespace UIDs. |
| `X-CXF-OWNER-NAME` | no | Human-readable vault owner name. |
| `X-CXF-OWNER-EMAIL` | no | Owner email. Omit if the producer treats it as private. |
| `X-CXF-ENTITY-COUNT` | no | Total component count (excluding VSCHEMA). Useful for progress reporting. |

---

## 3. Universal Component Properties

Every component — VEVENT, VTODO, VJOURNAL, and VCONTEXT — MUST carry these CXF properties in addition to the RFC 5545 required fields:

| Property | Required | Description |
|---|---|---|
| `UID` | yes | `{entity_id}@{vault_id}` — globally unique, stable across exports |
| `CREATED` | yes | ISO-8601 creation timestamp |
| `LAST-MODIFIED` | yes | ISO-8601 last modification timestamp. Used for incremental sync. |
| `CATEGORIES` | no | Comma-separated tags |
| `X-CXF-ID` | yes | The raw entity ID within the vault |
| `X-CXF-TYPE` | yes | The context type slug (e.g. `task`, `goal`, `person`, `recipe`) |
| `X-CXF-VAULT-ID` | no | Repeats the vault ID from the envelope. Useful when merging documents. |
| `X-CXF-LINK` | no | Zero or more outbound graph edges. See §6. |
| `X-CXF-STATUS-EXT` | no | Extended status when ICS STATUS values are insufficient. See §4.1. |

---

## 4. Standard Components with CXF Extensions

### 4.1 VTODO — Tasks, Goals, Todonts

Use VTODO for any entity representing work, intent, or a constraint on behaviour.

```
BEGIN:VTODO
UID:{id}@{vault_id}
SUMMARY:{title}
DESCRIPTION:{markdown body}
DTSTART:{startDate — YYYYMMDD or ISO datetime}
DUE:{dueDate — YYYYMMDD}
PRIORITY:{1=critical | 3=high | 5=medium | 9=low}
STATUS:{NEEDS-ACTION | IN-PROCESS | COMPLETED | CANCELLED}
CATEGORIES:{comma,separated,tags}
CREATED:{ISO-8601}
LAST-MODIFIED:{ISO-8601}
ORGANIZER;CN={ownerName}:mailto:{ownerEmail}
[ATTENDEE lines — see §5]
X-CXF-ID:{entity_id}
X-CXF-TYPE:{task | goal | todont | custom_type}
[X-CXF-FIELD-* — custom fields — see §7]
[X-CXF-LINK — graph edges — see §6]
[X-CXF-STATUS-EXT:{blocked | paused | deferred} — when STATUS alone is insufficient]
END:VTODO
```

**Status mapping:**

| Context value | ICS STATUS | X-CXF-STATUS-EXT |
|---|---|---|
| open | NEEDS-ACTION | — |
| in-progress | IN-PROCESS | — |
| done | COMPLETED | — |
| blocked | IN-PROCESS | blocked |
| paused | IN-PROCESS | paused |

**Todonts:** A todont is a negative intent — something to deliberately NOT do. It uses `X-CXF-TYPE:todont` and carries a standard STATUS that reflects its actual state. The default STATUS is IN-PROCESS (actively managing the avoidance). NEEDS-ACTION means the commitment hasn't been acted on yet, COMPLETED means the pattern has been broken, CANCELLED means the todont was retired. The `X-CXF-FIELD-REASON` property carries the rationale.

**Priority mapping:**

| Context | ICS PRIORITY |
|---|---|
| critical | 1 |
| high | 3 |
| medium | 5 |
| low | 9 |
| *(unset)* | 0 (undefined) |

### 4.2 VEVENT — Calendar Events

```
BEGIN:VEVENT
UID:{id}@{vault_id}
SUMMARY:{title}
DESCRIPTION:{markdown body}
DTSTART:{startDate — ISO datetime with UTC offset}
DURATION:{e.g. PT1H30M}
LOCATION:{location}
CATEGORIES:{comma,separated,tags}
CREATED:{ISO-8601}
LAST-MODIFIED:{ISO-8601}
ORGANIZER;CN={ownerName}:mailto:{ownerEmail}
[ATTENDEE lines — see §5]
X-CXF-ID:{entity_id}
X-CXF-TYPE:event
[X-CXF-FIELD-* — custom fields]
[X-CXF-LINK — graph edges]
END:VEVENT
```

### 4.3 VJOURNAL — Notes

```
BEGIN:VJOURNAL
UID:{id}@{vault_id}
SUMMARY:{title}
DESCRIPTION:{markdown body}
DTSTART:{createdAt — YYYYMMDD}
CATEGORIES:{comma,separated,tags}
CREATED:{ISO-8601}
LAST-MODIFIED:{ISO-8601}
X-CXF-ID:{entity_id}
X-CXF-TYPE:note
[X-CXF-FIELD-* — custom fields]
[X-CXF-LINK — graph edges]
END:VJOURNAL
```

---

## 5. People as ATTENDEE

When a context node of any type has a link to a `person` entity, that person is resolved to an `ATTENDEE` property on the linking component. Persons are **never** exported as standalone components — they exist only as ATTENDEE records (and optionally as VCONTEXT — see §5.2).

### 5.1 ATTENDEE Format

```
ATTENDEE;CN={person_title};ROLE={role};PARTSTAT=NEEDS-ACTION;
 X-CXF-PERSON-ID={person_entity_id}:mailto:{email or id@cxf.local}
```

**Role mapping from link label:**

| Link label | ICS ROLE |
|---|---|
| assigned-to, owner, responsible, lead | CHAIR |
| team-member, participant, player, member, attendee | REQ-PARTICIPANT |
| invited, optional | OPT-PARTICIPANT |
| observer, cc, notify, watcher | NON-PARTICIPANT |
| *(any other)* | REQ-PARTICIPANT |

**Email resolution:**
1. Use `meta.email` on the person entity if present.
2. Otherwise synthesize `{person_id}@cxf.local` as a stable placeholder.

Consumers MUST use `X-CXF-PERSON-ID` as the canonical identity key, not the email address. The `@cxf.local` suffix is a placeholder — it is not a real email and MUST NOT be used to send mail.

### 5.2 People as VCONTEXT (optional)

Producers MAY export person entities as VCONTEXT components in addition to resolving them as ATTENDEEs. This lets consumers build a contact graph independently of task/event association.

```
BEGIN:VCONTEXT
UID:{person_id}@{vault_id}
X-CXF-TYPE:person
SUMMARY:{full name}
DESCRIPTION:{markdown notes about the person}
CREATED:{ISO-8601}
LAST-MODIFIED:{ISO-8601}
X-CXF-FIELD-LASTNAME:{lastName}
X-CXF-FIELD-TYPE:{colleague | friend | family | ...}
X-CXF-FIELD-EMAIL:{email}
[X-CXF-LINK — graph edges to tasks, events, etc.]
END:VCONTEXT
```

---

## 6. Graph Edges — X-CXF-LINK

Every component can carry zero or more `X-CXF-LINK` properties encoding outbound edges in the knowledge graph. The edge target is the UID of another component in the same document (or a known external vault).

### 6.1 Format

```
X-CXF-LINK;LABEL={relation_label};EDGE={edge_kind}:{target_uid}
```

| Parameter | Required | Values | Description |
|---|---|---|---|
| `LABEL` | yes | any string | The relationship label. E.g. `assigned-to`, `blocks`, `relates-to`, `part-of`, `contributes-to`. |
| `EDGE` | no | `link` \| `mention` \| `reference` | The edge kind. Default: `link`. |

**Edge kinds:**

| Kind | Meaning |
|---|---|
| `link` | Explicit, intentional relationship declared in frontmatter. Highest fidelity. |
| `mention` | Person mentioned inline in the body via `@slug` syntax. Implicit. |
| `reference` | Entity referenced inline via `type:slug` syntax. Implicit. |

### 6.2 Examples

```
X-CXF-LINK;LABEL=contributes-to;EDGE=link:goal-build-team-e5f6@vault1
X-CXF-LINK;LABEL=blocks;EDGE=link:task-deploy-infra-a1b2@vault1
X-CXF-LINK;LABEL=assigned-to;EDGE=link:person-bob-smith-c3d4@vault1
X-CXF-LINK;LABEL=mentioned;EDGE=mention:person-alice-jones-g7h8@vault1
```

### 6.3 Graph reconstruction

A consumer builds the full graph by:
1. Indexing all components by UID.
2. For each component, iterating `X-CXF-LINK` properties.
3. Resolving the target UID to a component.
4. Creating a directed edge `(source_id) -[LABEL/EDGE]-> (target_id)`.

The graph is directed. Producers emit edges from the perspective of the source entity. Consumers who need bidirectional traversal invert the edges in their own store.

---

## 7. VSCHEMA — Type Schema Declaration

VSCHEMA declares the schema for a context type. Producers SHOULD include one VSCHEMA per distinct `X-CXF-TYPE` value that appears in the document. Consumers use VSCHEMA to understand the meaning and type of `X-CXF-FIELD-*` properties.

```
BEGIN:VSCHEMA
X-CXF-TYPE-NAME:{type_slug}
X-CXF-PLURAL:{plural_slug}
X-CXF-DESCRIPTION:{human description of what this type represents}
X-CXF-BUILT-IN:{TRUE | FALSE}
X-CXF-FIELD;KEY={key};TYPE={field_type};REQUIRED={TRUE|FALSE}[;VALUES={a\,b\,c}][;DEFAULT={v}]:{field_label}
[additional X-CXF-FIELD lines...]
X-CXF-COMPLETION-FIELD:{field_key — field that marks this type as "done", if any}
X-CXF-COMPLETION-VALUE:{value of the completion field when done, e.g. "done"}
X-CXF-CALENDAR-DATE-FIELD:{field_key — field treated as the primary date for calendar display}
END:VSCHEMA
```

### 7.1 Field Types

| CXF type | Description |
|---|---|
| `string` | Free-form text |
| `number` | Numeric value |
| `boolean` | `true` or `false` |
| `date` | `YYYY-MM-DD` |
| `datetime` | ISO-8601 with UTC offset |
| `duration` | ISO-8601 duration (e.g. `PT1H30M`) |
| `enum` | One of a fixed set of values declared in `VALUES` |
| `array` | JSON-encoded array of strings |
| `object` | JSON-encoded object |

### 7.2 Example VSCHEMA for `goal`

```
BEGIN:VSCHEMA
X-CXF-TYPE-NAME:goal
X-CXF-PLURAL:goals
X-CXF-DESCRIPTION:Long-term aspirations and objectives
X-CXF-BUILT-IN:FALSE
X-CXF-FIELD;KEY=status;TYPE=enum;VALUES=active\,achieved\,abandoned\,paused;
 REQUIRED=TRUE;DEFAULT=active:Status
X-CXF-FIELD;KEY=priority;TYPE=enum;VALUES=low\,medium\,high\,critical;
 REQUIRED=FALSE;DEFAULT=medium:Priority
X-CXF-FIELD;KEY=target_date;TYPE=date;REQUIRED=FALSE:Target Date
X-CXF-FIELD;KEY=milestones;TYPE=array;REQUIRED=FALSE:Milestones
X-CXF-COMPLETION-FIELD:status
X-CXF-COMPLETION-VALUE:achieved
END:VSCHEMA
```

---

## 8. VCONTEXT — Custom Context Nodes

VCONTEXT carries any entity that is not natively a VEVENT, VTODO, or VJOURNAL. This includes goals, todonts, people, and any user-defined type.

```
BEGIN:VCONTEXT
UID:{entity_id}@{vault_id}
SUMMARY:{title}
DESCRIPTION:{markdown body — may be empty}
CREATED:{ISO-8601}
LAST-MODIFIED:{ISO-8601}
CATEGORIES:{comma,separated,tags}
X-CXF-ID:{entity_id}
X-CXF-TYPE:{type_slug}
X-CXF-FIELD-{KEY}:{value}
[additional X-CXF-FIELD-* lines]
[ATTENDEE lines — if this type can have person links, e.g. a team]
[X-CXF-LINK lines]
END:VCONTEXT
```

### 8.1 Custom Field Encoding

Each field defined in VSCHEMA maps to a `X-CXF-FIELD-{KEY}` property on VCONTEXT. Key is uppercased.

```
X-CXF-FIELD-STATUS:active
X-CXF-FIELD-PRIORITY:high
X-CXF-FIELD-TARGET_DATE:20261231
X-CXF-FIELD-MILESTONES:["Q2 hiring complete","Q3 team health >80%"]
```

For `array` and `object` types, the value is JSON-encoded and the entire property is folded per RFC 5545 line-length rules.

### 8.2 Type Routing Rules

Producers MUST apply this routing when serialising a context node:

| Condition | ICS Component |
|---|---|
| `entity_type == "event"` | VEVENT |
| `entity_type == "task"` | VTODO |
| `entity_type == "note"` | VJOURNAL |
| `entity_type == "todont"` | VTODO with `X-CXF-TYPE:todont` and standard STATUS |
| all other types | VCONTEXT with `X-CXF-TYPE:{type}` |

This routing is fixed. Producers MUST NOT use VCONTEXT for events, tasks, or notes. Consumers MUST check `X-CXF-TYPE` alongside the component type when discriminating todont from task.

---

## 9. Deletion / Tombstones

ICS has no native delete signal. CXF uses status tombstones:

- Deleted VEVENT/VTODO/VJOURNAL: `STATUS:CANCELLED` + `X-CXF-DELETED:TRUE`
- Deleted VCONTEXT: `X-CXF-DELETED:TRUE` (VCONTEXT has no STATUS)

Producers MUST include tombstones in incremental exports for at least one full sync cycle after deletion. After that, the component may be omitted. Consumers MUST treat `X-CXF-DELETED:TRUE` as a hard delete signal.

---

## 10. Transport — The CXF Endpoint

A producer exposes a single HTTP endpoint:

```
GET /api/cxf
Content-Type: text/cxf; charset=utf-8
```

### 10.1 Query Parameters

| Parameter | Description | Example |
|---|---|---|
| `types` | Comma-separated type slugs. Default: all. | `types=task,goal,event` |
| `since` | ISO-8601 timestamp. Returns only nodes with `LAST-MODIFIED ≥ since`. | `since=2026-04-21T00:00:00Z` |
| `include_schema` | `true` (default) or `false`. Whether to include VSCHEMA blocks. | `include_schema=false` |
| `include_graph` | `true` (default) or `false`. Whether to include `X-CXF-LINK` properties. | `include_graph=false` |
| `tags` | Comma-separated tags (AND filter). | `tags=work,urgent` |

### 10.2 Response Headers

```
Content-Type: text/cxf; charset=utf-8
X-CXF-Export-Time: 2026-04-21T09:00:00Z
X-CXF-Entity-Count: 214
X-CXF-Schema-Count: 8
```

### 10.3 Incremental Sync (Recommended Pattern for COS)

```
1. First run:    GET /api/cxf
                 → full export; record X-CXF-Export-Time as cursor

2. Subsequent:   GET /api/cxf?since={cursor}
                 → only nodes changed since last export; update cursor

3. For each component:
   a. Parse UID → entity_id@vault_id
   b. Check X-CXF-DELETED — if TRUE, tombstone and skip
   c. Check LAST-MODIFIED vs stored; skip if unchanged
   d. Route by X-CXF-TYPE → correct COS context type
   e. Parse X-CXF-FIELD-* using VSCHEMA for types
   f. Parse ATTENDEE → resolve/upsert people by X-CXF-PERSON-ID
   g. Parse X-CXF-LINK → upsert graph edges
   h. Upsert node record
```

---

## 11. Versioning and Compatibility

- `X-CXF-VERSION:1` is the only defined version.
- Consumers MUST ignore unknown X-CXF- properties (forward compatibility).
- Consumers MUST ignore unknown VSCHEMA and VCONTEXT components they cannot parse.
- Producers MUST NOT remove properties defined in this spec without a version bump.
- Future versions will use `X-CXF-VERSION:2`, etc. Consumers SHOULD reject documents with versions they do not support.

---

## 12. Line Folding

RFC 5545 §3.1: lines longer than 75 octets MUST be folded at a CRLF followed by a single space. This applies to:

- `DESCRIPTION` fields with markdown body content
- `X-CXF-FIELD-*` with JSON array/object values
- `ATTENDEE` with multiple parameters

CXF-aware parsers MUST unfold lines before tokenising. Most iCalendar libraries handle this automatically.

---

## 13. Full Worked Example

A vault with five entities and a knowledge graph between them:

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Phaibel//Phaibel Agent v5//EN
X-CXF-VERSION:1
X-CXF-EXPORT-TIME:20260421T090000Z
X-CXF-VAULT-ID:vault-gary-clift-01
X-CXF-OWNER-NAME:Gary Clift
X-CXF-OWNER-EMAIL:gary@clift-labs.com
X-CXF-ENTITY-COUNT:5

BEGIN:VSCHEMA
X-CXF-TYPE-NAME:goal
X-CXF-PLURAL:goals
X-CXF-DESCRIPTION:Long-term aspirations and objectives
X-CXF-BUILT-IN:FALSE
X-CXF-FIELD;KEY=status;TYPE=enum;VALUES=active\,achieved\,abandoned;
 REQUIRED=TRUE;DEFAULT=active:Status
X-CXF-FIELD;KEY=priority;TYPE=enum;VALUES=low\,medium\,high\,critical;
 REQUIRED=FALSE:Priority
X-CXF-COMPLETION-FIELD:status
X-CXF-COMPLETION-VALUE:achieved
END:VSCHEMA

BEGIN:VSCHEMA
X-CXF-TYPE-NAME:todont
X-CXF-PLURAL:todonts
X-CXF-DESCRIPTION:Things to deliberately NOT do
X-CXF-BUILT-IN:FALSE
X-CXF-FIELD;KEY=reason;TYPE=string;REQUIRED=FALSE:Reason
END:VSCHEMA

BEGIN:VSCHEMA
X-CXF-TYPE-NAME:person
X-CXF-PLURAL:people
X-CXF-DESCRIPTION:People — contacts\, colleagues\, family\, friends
X-CXF-BUILT-IN:FALSE
X-CXF-FIELD;KEY=lastName;TYPE=string;REQUIRED=FALSE:Last Name
X-CXF-FIELD;KEY=type;TYPE=string;REQUIRED=FALSE:Relationship Type
X-CXF-FIELD;KEY=email;TYPE=string;REQUIRED=FALSE:Email
END:VSCHEMA

BEGIN:VTODO
UID:task-review-bob-a1b2@vault-gary-clift-01
SUMMARY:Review Bob's performance
DESCRIPTION:Prepare constructive feedback for Bob's Q2 review.\n\nKey
 themes: delivery consistency\, communication across teams.
DUE:20260430
PRIORITY:3
STATUS:NEEDS-ACTION
CREATED:20260410T090000Z
LAST-MODIFIED:20260420T140000Z
CATEGORIES:hr,management,q2
ORGANIZER;CN=Gary Clift:mailto:gary@clift-labs.com
ATTENDEE;CN=Bob Smith;ROLE=CHAIR;PARTSTAT=NEEDS-ACTION;
 X-CXF-PERSON-ID=bob-smith-c3d4:mailto:bob@acme.com
X-CXF-ID:task-review-bob-a1b2
X-CXF-TYPE:task
X-CXF-LINK;LABEL=relates-to;EDGE=link:
 goal-great-team-e5f6@vault-gary-clift-01
END:VTODO

BEGIN:VCONTEXT
UID:goal-great-team-e5f6@vault-gary-clift-01
SUMMARY:Build a great engineering team
DESCRIPTION:Focus on hiring\, culture\, growth paths\, and reducing
 attrition. Target team health score >80% by year end.
CREATED:20260101T000000Z
LAST-MODIFIED:20260415T100000Z
CATEGORIES:leadership,hiring,annual
X-CXF-ID:goal-great-team-e5f6
X-CXF-TYPE:goal
X-CXF-FIELD-STATUS:active
X-CXF-FIELD-PRIORITY:high
X-CXF-LINK;LABEL=relates-to;EDGE=link:
 task-review-bob-a1b2@vault-gary-clift-01
END:VCONTEXT

BEGIN:VEVENT
UID:event-soccer-u12-g7h8@vault-gary-clift-01
SUMMARY:Under-12 Soccer Match vs Westside
DESCRIPTION:Regular season match. Arrive 30 min early for warm-up.
DTSTART:20260425T140000-06:00
DURATION:PT1H30M
LOCATION:Riverside Park\, Field 3
CREATED:20260401T080000Z
LAST-MODIFIED:20260418T090000Z
CATEGORIES:family,kids,soccer
ORGANIZER;CN=Gary Clift:mailto:gary@clift-labs.com
ATTENDEE;CN=Jamie Torres;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;
 X-CXF-PERSON-ID=jamie-torres-ab12:
 mailto:jamie-torres-ab12@cxf.local
ATTENDEE;CN=Sam Reeves;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;
 X-CXF-PERSON-ID=sam-reeves-cd34:
 mailto:sam-reeves-cd34@cxf.local
X-CXF-ID:event-soccer-u12-g7h8
X-CXF-TYPE:event
X-CXF-FIELD-TEAM-SIZE:20
END:VEVENT

BEGIN:VTODO
UID:todont-micromanage-i9j0@vault-gary-clift-01
SUMMARY:Don't micromanage delivery timelines
DESCRIPTION:Reduces team autonomy and signals distrust. Coach instead.
STATUS:IN-PROCESS
CREATED:20260210T090000Z
LAST-MODIFIED:20260210T090000Z
CATEGORIES:leadership,behaviour
X-CXF-ID:todont-micromanage-i9j0
X-CXF-TYPE:todont
X-CXF-FIELD-REASON:Kills team autonomy and slows delivery velocity.
X-CXF-LINK;LABEL=relates-to;EDGE=link:
 goal-great-team-e5f6@vault-gary-clift-01
END:VTODO

BEGIN:VJOURNAL
UID:note-q3-strategy-k1l2@vault-gary-clift-01
SUMMARY:Thoughts on Q3 strategy
DESCRIPTION:## Q3 Direction\n\nFocus on consolidation over new
 features. Three themes:\n\n1. Team stability\n2. Technical debt
 \n3. Customer retention
DTSTART:20260418
CREATED:20260418T110000Z
LAST-MODIFIED:20260418T113000Z
CATEGORIES:strategy,q3,planning
X-CXF-ID:note-q3-strategy-k1l2
X-CXF-TYPE:note
X-CXF-LINK;LABEL=relates-to;EDGE=link:
 goal-great-team-e5f6@vault-gary-clift-01
END:VJOURNAL

END:VCALENDAR
```

---

## 14. Parser Implementation Guide

### Minimum viable CXF parser

```
1. Parse the VCALENDAR block using any RFC 5545 library.
2. Extract VSCHEMA components → build type schema registry.
3. For each remaining component:
   a. Determine routing: VEVENT / VTODO / VJOURNAL / VCONTEXT
   b. Read UID → split on "@" to get entity_id and vault_id
   c. Read X-CXF-TYPE → look up schema in registry
   d. Read X-CXF-DELETED — if present and TRUE, tombstone
   e. Read LAST-MODIFIED → compare to stored; skip if unchanged
   f. Read ATTENDEE lines → build person records (key: X-CXF-PERSON-ID)
   g. Read X-CXF-FIELD-* → apply schema types for casting
   h. Read X-CXF-LINK → store as directed graph edges
4. Upsert all records and edges.
5. Record X-CXF-Export-Time as the new incremental cursor.
```

### Edge cases

- **Missing VSCHEMA**: Consumer should treat all `X-CXF-FIELD-*` values as strings.
- **Unknown X-CXF-TYPE**: Store as generic VCONTEXT without type-specific processing.
- **Circular links**: Valid. The graph may have cycles (e.g. two goals that relate-to each other). Consumer must handle cycles in traversal.
- **ATTENDEE without X-CXF-PERSON-ID**: Consumer may still ingest using CN + email as identity, but should flag as unresolvable.
- **Folded JSON in X-CXF-FIELD-***: Unfold the full property value before JSON parsing.

---

## 15. Relationship to ICS and FCP

CXF and FCP are complementary:

| | FCP | CXF |
|---|---|---|
| **Transport** | HTTP probe/fetch | HTTP GET (pull) |
| **Format** | JSON | iCalendar extension |
| **Primary use** | Real-time query-driven context retrieval | Bulk export / sync |
| **Graph** | Via `links[]` in fetch response | Via `X-CXF-LINK` |
| **Schema** | Discovered via `/fcp/manifest` | Embedded as VSCHEMA |
| **Incremental** | Via `keywords` + `time_range` | Via `?since=` cursor |
| **Best for** | Chat-time context retrieval | ETL, backup, bulk import |

A system can implement both. FCP is the real-time read protocol; CXF is the bulk exchange format. COS uses CXF for its initial data load and delta sync, and FCP for query-time context retrieval.

---

## 16. Conformance

A producer is CXF/1 conformant if:

1. Every produced document contains `X-CXF-VERSION:1`.
2. Every component carries `X-CXF-ID`, `X-CXF-TYPE`, `CREATED`, and `LAST-MODIFIED`.
3. Type routing rules in §8.2 are respected.
4. A VSCHEMA is present for every distinct `X-CXF-TYPE` that appears in the document.
5. `X-CXF-PERSON-ID` is present on every ATTENDEE property.
6. `X-CXF-DELETED:TRUE` is emitted for at least one export cycle after deletion.
7. The document is parseable by a compliant RFC 5545 library (all CXF-specific content is X- properties or named components that RFC 5545 permits).

---

## Appendix A — Reserved X-CXF- Property Names

| Property | Description |
|---|---|
| `X-CXF-VERSION` | Envelope: CXF format version |
| `X-CXF-EXPORT-TIME` | Envelope: export timestamp |
| `X-CXF-VAULT-ID` | Envelope/component: vault identifier |
| `X-CXF-OWNER-NAME` | Envelope: vault owner name |
| `X-CXF-OWNER-EMAIL` | Envelope: vault owner email |
| `X-CXF-ENTITY-COUNT` | Envelope: total component count |
| `X-CXF-ID` | Component: raw entity ID |
| `X-CXF-TYPE` | Component: context type slug |
| `X-CXF-DELETED` | Component: tombstone flag |
| `X-CXF-STATUS-EXT` | Component: extended status |
| `X-CXF-LINK` | Component: graph edge (multiple) |
| `X-CXF-PERSON-ID` | ATTENDEE parameter: person entity ID |
| `X-CXF-FIELD-*` | Component: custom field value |
| `X-CXF-TYPE-NAME` | VSCHEMA: type slug |
| `X-CXF-PLURAL` | VSCHEMA: plural slug |
| `X-CXF-DESCRIPTION` | VSCHEMA: type description |
| `X-CXF-BUILT-IN` | VSCHEMA: whether this is a built-in type |
| `X-CXF-FIELD` | VSCHEMA: field definition (multiple) |
| `X-CXF-COMPLETION-FIELD` | VSCHEMA: field that signals completion |
| `X-CXF-COMPLETION-VALUE` | VSCHEMA: value that signals completion |
| `X-CXF-CALENDAR-DATE-FIELD` | VSCHEMA: primary calendar date field |

---

## Appendix B — Change Log

| Version | Date | Notes |
|---|---|---|
| 1.0 | 2026-04-21 | Initial draft |
