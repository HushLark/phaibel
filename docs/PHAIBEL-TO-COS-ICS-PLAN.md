# Phaibel → COS: ICS Export Plan

**Status:** Draft  
**Audience:** COS developer  
**Purpose:** Define how Phaibel exports its entity graph to COS using iCalendar (ICS/RFC 5545) format, including tasks, events, goals, todonts, notes, and all linked context nodes (people, teams, related entities).

---

## 1. Why ICS?

ICS (RFC 5545) is a universal interchange format understood by every calendar client and most task managers. It natively supports:

- **VTODO** — tasks with due dates, priority, status, and attendees
- **VEVENT** — calendar events with times, locations, and attendees
- **VJOURNAL** — notes and journal entries

Its **ATTENDEE** property is ideal for Phaibel's linked-people model: a soccer match with 20 team members maps directly to 20 ATTENDEE lines. Its **X-** custom property namespace handles everything ICS doesn't natively support (goals, todonts, link graphs).

COS can consume the feed via a simple HTTP GET and process it incrementally using `LAST-MODIFIED` timestamps.

---

## 2. Entity Type → ICS Component Mapping

| Phaibel Type | ICS Component | Notes |
|---|---|---|
| `task` | `VTODO` | status/priority mapped to ICS equivalents |
| `goal` | `VTODO` | `X-PHAIBEL-TYPE:goal` distinguishes from task |
| `todont` | `VTODO` | `X-PHAIBEL-TYPE:todont`; STATUS always CANCELLED to signal "do not do" |
| `event` | `VEVENT` | startDate → DTSTART; duration → DURATION |
| `note` | `VJOURNAL` | createdAt → DTSTART |
| `person` | Not exported directly | Resolved inline as ATTENDEE on linked entities |
| Custom types | `VJOURNAL` | `X-PHAIBEL-TYPE:{type}` preserves the original type name |

---

## 3. Field Mappings

### 3.1 VTODO (task / goal / todont)

```
BEGIN:VTODO
UID:{entity_id}@phaibel
SUMMARY:{title}
DESCRIPTION:{body_markdown}
DTSTART:{startDate as YYYYMMDD}
DUE:{dueDate as YYYYMMDD}
PRIORITY:{1=critical, 3=high, 5=medium, 9=low}
STATUS:{NEEDS-ACTION|IN-PROCESS|COMPLETED|CANCELLED}
CATEGORIES:{comma,separated,tags}
CREATED:{createdAt as ISO}
LAST-MODIFIED:{updatedAt as ISO}
ORGANIZER;CN={userName}:mailto:{userEmail or vault-owner@phaibel.local}
X-PHAIBEL-TYPE:{task|goal|todont}
X-PHAIBEL-ID:{entity_id}
X-PHAIBEL-VAULT:{vault_root_hash_or_name}
X-PHAIBEL-REASON:{reason field — todont only}
[ATTENDEE lines — see §4]
[X-PHAIBEL-LINK lines — see §5]
END:VTODO
```

**Status mapping:**

| Phaibel | ICS VTODO STATUS |
|---|---|
| open | NEEDS-ACTION |
| in-progress | IN-PROCESS |
| done | COMPLETED |
| blocked | IN-PROCESS (+ X-PHAIBEL-STATUS:blocked) |
| *(todont)* | CANCELLED |

**Priority mapping:**

| Phaibel | ICS PRIORITY |
|---|---|
| critical | 1 |
| high | 3 |
| medium | 5 |
| low | 9 |

### 3.2 VEVENT (event)

```
BEGIN:VEVENT
UID:{entity_id}@phaibel
SUMMARY:{title}
DESCRIPTION:{body_markdown}
DTSTART:{startDate as ISO with timezone}
DURATION:{duration — e.g. PT1H30M}
LOCATION:{location}
CATEGORIES:{comma,separated,tags}
CREATED:{createdAt}
LAST-MODIFIED:{updatedAt}
ORGANIZER;CN={userName}:mailto:{userEmail or vault-owner@phaibel.local}
X-PHAIBEL-TYPE:event
X-PHAIBEL-ID:{entity_id}
[ATTENDEE lines — see §4]
[X-PHAIBEL-LINK lines — see §5]
END:VEVENT
```

### 3.3 VJOURNAL (note / custom types)

```
BEGIN:VJOURNAL
UID:{entity_id}@phaibel
SUMMARY:{title}
DESCRIPTION:{body_markdown}
DTSTART:{createdAt as YYYYMMDD}
CATEGORIES:{comma,separated,tags}
CREATED:{createdAt}
LAST-MODIFIED:{updatedAt}
X-PHAIBEL-TYPE:{note|custom_type_name}
X-PHAIBEL-ID:{entity_id}
[X-PHAIBEL-LINK lines — see §5]
END:VJOURNAL
```

---

## 4. People Expansion — ATTENDEE Lines

Every entity in Phaibel can have `links` in its frontmatter: `[{ target: "type:id", label: "relation" }]`. When the linked entity is a `person`, it is resolved to an ICS **ATTENDEE** property on the parent component.

### 4.1 ATTENDEE format

```
ATTENDEE;CN={person_title};ROLE={role};PARTSTAT=NEEDS-ACTION;X-PHAIBEL-PERSON-ID={person_id}:mailto:{email or person_id@phaibel.local}
```

**Role mapping from link label:**

| Link label | ICS ROLE |
|---|---|
| assigned-to, owner, responsible | CHAIR |
| team-member, participant, player, member | REQ-PARTICIPANT |
| attendee, invited | OPT-PARTICIPANT |
| observer, cc, notify | NON-PARTICIPANT |
| *(any other label)* | REQ-PARTICIPANT |

### 4.2 Email resolution

Phaibel's `person` entity has no required email field. Resolution order:
1. Use `meta.email` if present
2. Use `{person_id}@phaibel.local` as a stable synthetic address

COS should treat `@phaibel.local` addresses as internal references, not real email addresses. Match people across future updates using `X-PHAIBEL-PERSON-ID`, not the email.

### 4.3 The delegation example

A task "Prepare Q3 board deck" with a link `{ target: "person:bob-smith-abc1", label: "assigned-to" }`:

```
BEGIN:VTODO
UID:task-xyz789@phaibel
SUMMARY:Prepare Q3 board deck
DUE:20260428
PRIORITY:1
STATUS:IN-PROCESS
ORGANIZER;CN=Gary:mailto:gary@clift-labs.com
ATTENDEE;CN=Bob Smith;ROLE=CHAIR;PARTSTAT=NEEDS-ACTION;
 X-PHAIBEL-PERSON-ID=bob-smith-abc1:mailto:bob@acme.com
X-PHAIBEL-TYPE:task
X-PHAIBEL-LINK:person:bob-smith-abc1|assigned-to
END:VTODO
```

### 4.4 The soccer match example

An event "Under-12 Match vs Westside" with 20 team members linked via `team-member`:

```
BEGIN:VEVENT
UID:event-soccer001@phaibel
SUMMARY:Under-12 Match vs Westside
DTSTART:20260425T140000
DURATION:PT1H30M
LOCATION:Riverside Park, Field 3
ATTENDEE;CN=Jamie Torres;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;
 X-PHAIBEL-PERSON-ID=jamie-torres-ab12:mailto:jamie-torres-ab12@phaibel.local
ATTENDEE;CN=Sam Reeves;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;
 X-PHAIBEL-PERSON-ID=sam-reeves-cd34:mailto:sam-reeves-cd34@phaibel.local
[... 18 more ATTENDEE lines ...]
X-PHAIBEL-TYPE:event
X-PHAIBEL-TEAM-SIZE:20
END:VEVENT
```

COS receives all 20 people with their Phaibel IDs in a single VEVENT, no secondary lookup required.

---

## 5. Non-Person Linked Nodes — X-PHAIBEL-LINK

When a linked entity is not a person (e.g., a goal linked to a project, a task linked to a note), it is encoded as `X-PHAIBEL-LINK` custom properties rather than ATTENDEE lines. One property per link:

```
X-PHAIBEL-LINK:{entity_type}:{entity_id}|{link_label}
```

Examples:
```
X-PHAIBEL-LINK:goal:goal-abc123|contributes-to
X-PHAIBEL-LINK:note:note-xyz456|references
X-PHAIBEL-LINK:event:event-789abc|blocks
```

COS can use these to reconstruct the knowledge graph. Since COS has the full ICS, all referenced entities will also appear as their own ICS components and can be correlated by ID.

---

## 6. Transport — The ICS Endpoint

Phaibel exposes a single HTTP endpoint:

```
GET /api/ics
```

### 6.1 Query parameters

| Parameter | Description | Example |
|---|---|---|
| `types` | Comma-separated entity types to include. Default: all. | `types=task,event` |
| `since` | ISO-8601 timestamp. Returns only entities with `LAST-MODIFIED` ≥ this value. | `since=2026-04-20T00:00:00Z` |
| `status` | Filter tasks/goals by status. | `status=open,in-progress` |
| `tags` | Comma-separated tag filter (AND). | `tags=work,urgent` |

### 6.2 Response

```
Content-Type: text/calendar; charset=utf-8
X-Phaibel-Export-Time: 2026-04-21T09:00:00Z
X-Phaibel-Entity-Count: 147
```

Body is a single `VCALENDAR` block containing all matching components.

### 6.3 Full export

```
GET /api/ics
```

### 6.4 Incremental poll (recommended for COS)

COS records the timestamp of each successful fetch and passes it on the next call:

```
GET /api/ics?since=2026-04-21T08:00:00Z
```

The response contains only entities created or modified since that time. COS processes and upserts these into its own store.

---

## 7. The Full VCALENDAR Envelope

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Phaibel//Phaibel Agent v5//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:{agentName}'s Vault
X-PHAIBEL-VAULT:{vault_root}
X-PHAIBEL-EXPORT-TIME:{ISO timestamp}
X-PHAIBEL-OWNER:{userName}
X-PHAIBEL-OWNER-EMAIL:{userEmail}

[VTODO, VEVENT, VJOURNAL components ...]

END:VCALENDAR
```

---

## 8. Incremental Sync Strategy for COS

```
COS on schedule (e.g. every 5 minutes or on-demand):

1. GET /api/ics?since={last_sync_time}
2. For each component:
   a. Extract UID (= entity_id@phaibel)
   b. Check LAST-MODIFIED vs stored record
   c. If new or changed:
      - Parse ATTENDEE lines → resolve/upsert people
      - Parse X-PHAIBEL-LINK lines → store link graph
      - Upsert the entity record
3. Record new last_sync_time = X-Phaibel-Export-Time header
```

**Deletion**: ICS has no native delete signal. Phaibel will include `STATUS:CANCELLED` on soft-deleted items for one sync cycle before dropping them. COS should treat CANCELLED as a tombstone.

---

## 9. ICS Line Folding

RFC 5545 requires lines longer than 75 octets to be folded (CRLF + space). DESCRIPTION fields containing markdown, and X-PHAIBEL-LINK with long IDs, will be folded. COS's ICS parser must correctly unfold these before processing.

Standard ICS unfolding: any CRLF followed by a single space or tab is a continuation. Most ICS libraries handle this automatically.

---

## 10. What Phaibel Needs to Build

| Component | Description |
|---|---|
| `GET /api/ics` endpoint | Serialize entity index to ICS with query param support |
| Entity → ICS serializer | Handles all 5 entity type mappings + X- properties |
| Person resolver | Walks `links[]`, fetches person entities, builds ATTENDEE lines |
| Link encoder | Encodes non-person links as `X-PHAIBEL-LINK` properties |
| `since` filter | Filters by `updatedAt ≥ since` using entity index |
| CANCELLED tombstones | Emit STATUS:CANCELLED for recently deleted entities for 1 cycle |

---

## 11. What COS Needs to Build

| Component | Description |
|---|---|
| ICS poller | `GET /api/ics?since=...` on schedule (5-minute default) |
| ICS parser | RFC 5545 compliant; handles VTODO, VEVENT, VJOURNAL, line folding |
| ATTENDEE extractor | `X-PHAIBEL-PERSON-ID` is the stable key; email is secondary |
| Link graph builder | Parse `X-PHAIBEL-LINK` properties, build cross-entity relationships |
| Upsert logic | Match on UID (entity_id@phaibel), update on LAST-MODIFIED change |
| Tombstone handler | CANCELLED → soft delete in COS store |
| Type discriminator | Use `X-PHAIBEL-TYPE` to route to correct COS context type |

---

## 12. Worked Example — Full Entity Set

A Phaibel vault with these entities:

- Task: "Review Bob's performance" (assigned-to Bob Smith, relates-to goal "Build great team")
- Goal: "Build a great engineering team"
- Event: "Under-12 Soccer Match" (20 team members)
- Todont: "Don't micromanage delivery"
- Note: "Thoughts on Q3 strategy"

Produces this ICS (abbreviated):

```ics
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Phaibel//Phaibel Agent v5//EN
X-PHAIBEL-OWNER:Gary Clift

BEGIN:VTODO
UID:task-rev-bob-a1b2@phaibel
SUMMARY:Review Bob's performance
DUE:20260430
PRIORITY:3
STATUS:NEEDS-ACTION
ORGANIZER;CN=Gary Clift:mailto:gary@clift-labs.com
ATTENDEE;CN=Bob Smith;ROLE=CHAIR;X-PHAIBEL-PERSON-ID=bob-smith-c3d4:
 mailto:bob@acme.com
X-PHAIBEL-TYPE:task
X-PHAIBEL-LINK:goal:goal-great-team-e5f6|relates-to
END:VTODO

BEGIN:VTODO
UID:goal-great-team-e5f6@phaibel
SUMMARY:Build a great engineering team
STATUS:NEEDS-ACTION
PRIORITY:3
X-PHAIBEL-TYPE:goal
END:VTODO

BEGIN:VEVENT
UID:event-soccer-u12-g7h8@phaibel
SUMMARY:Under-12 Soccer Match vs Westside
DTSTART:20260425T140000
DURATION:PT1H30M
LOCATION:Riverside Park\, Field 3
ATTENDEE;CN=Jamie Torres;ROLE=REQ-PARTICIPANT;
 X-PHAIBEL-PERSON-ID=jamie-torres-ab12:mailto:jamie-torres-ab12@phaibel.local
[... 19 more ATTENDEE lines ...]
X-PHAIBEL-TYPE:event
X-PHAIBEL-TEAM-SIZE:20
END:VEVENT

BEGIN:VTODO
UID:todont-micromanage-i9j0@phaibel
SUMMARY:Don't micromanage delivery
STATUS:CANCELLED
X-PHAIBEL-TYPE:todont
X-PHAIBEL-REASON:Kills team autonomy and slows delivery
END:VTODO

BEGIN:VJOURNAL
UID:note-q3-strategy-k1l2@phaibel
SUMMARY:Thoughts on Q3 strategy
DTSTART:20260418
CATEGORIES:strategy\,q3
X-PHAIBEL-TYPE:note
END:VJOURNAL

END:VCALENDAR
```

---

## 13. Open Questions

1. **Push vs poll?** Since COS is on the same host, Phaibel could POST to a COS webhook on entity write instead of COS polling. Simpler to start with poll; push can be added later.

2. **Timezone handling?** Phaibel stores datetimes with ISO 8601 offsets. ICS prefers VTIMEZONE blocks. For v1, UTC offsets in DTSTART/DTEND are sufficient; VTIMEZONE blocks can be added later.

3. **Recurring tasks?** Phaibel has recurring tasks (RRULE in ICS). Out of scope for v1 — recurring task instances are emitted individually.

4. **People without linked entities?** Should COS also receive a full snapshot of all `person` entities as standalone VJOURNALs? Useful for building a contact graph even without explicit task/event links. Recommended: yes, include all people as `VJOURNAL` with `X-PHAIBEL-TYPE:person`.

5. **Attachment/body size limit?** Markdown bodies on notes and goals can be large. COS should accept up to 64KB per DESCRIPTION. Truncate with `X-PHAIBEL-TRUNCATED:true` if body exceeds limit.
