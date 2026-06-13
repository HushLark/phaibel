# Relevance Dimensions

**Status:** Design spec (canonical) — drives the v2 relevance migration
**Last updated:** 2026-06-13
**Owner:** Clift Labs / Phaibel
**Implementation:** `src/cxms/relevance-scorer.ts`, `src/cxms/dimension-calculator.ts`, `src/entities/entity-type-config.ts`, `src/context/request-weights.ts`

---

## 1. Philosophy

Phaibel ranks context with a small, fixed set of **relevance dimensions**. Two principles govern the design:

1. **Everything revolves around the user.** The most meaningful fixed reference point in the entity graph is the **"me" node** (the vault owner). Graph-based signals are measured relative to the user, not in the abstract.
2. **Dimensions are not uniform across entity kinds.** A *Place* is ranked mostly by physical distance; a *Human* by closeness to you and how often you interact; an *Event* by where "now" sits in its time window. Each context type opts into the subset of dimensions that matter for it, with per-type weights.

The dimension **vocabulary is fixed and canonical** (this document). Each context type declares which dimensions it uses via `EntityTypeConfig.dimensions`; it does not invent new ones. This keeps the scorer and the per-query weighting (`request-weights`) in lockstep.

Scoring is **LLM-free at query time.** Every dimension is pure computation over precomputed data (embeddings, counters, stored timestamps, graph edges). LLM involvement is confined to *write time* (extracting fields, choosing windows) — never to retrieval.

---

## 2. The dimensions

| Layer | Anchor / source | Definition |
|---|---|---|
| **Temporal** | node's date field(s) | A graded **salience curve** over time (§4). Rises as a dated item approaches, peaks during it, and decays afterward to zero at the archive point. Its **nonzero support doubles as the candidacy filter** — a node is a temporal candidate iff its temporal score > 0. Undated nodes are timeless (constant 1). |
| **Semantic** | embedding index + query | Vector cosine similarity between the query and the node's embedded text. The "does this match what was asked" signal. |
| **Spatial** | node coordinates + current location | Physical proximity: inverse great-circle (haversine) distance from the user's current location, falling linearly to zero at `maxKm`. |
| **Social / User Proximity** | entity graph + the **"me" node** | Closeness **to the user**: BFS hop distance from the me-node, refined by relationship type (family > friend > colleague…) where a relationship exists. Universal — applies to any entity, not just people. **Stable across queries.** |
| **Goal Alignment** | entity graph + active goals | Whether the node serves an active goal: BFS hop distance to the nearest non-completed goal node. Closer = higher. |
| **Behavioral** | persisted interaction index | Interaction frequency: log-scaled count of how often the node has been fetched, surfaced, or returned. Frequently-touched entities rank up. No LLM. |
| **Recency** | node's `updated` timestamp | Edit-time decay: exponential half-life on last-updated. A **secondary / tie-break** signal, not a primary driver. Distinct from Temporal (event dates) — Recency is about how fresh the *record* is. |
| **Context Proximity** | entity graph + current anchors | Relevance **to the current conversation**: BFS hop distance from the nodes already in context. Catches graph-linked items semantic match misses (e.g. "renew SSL cert" → linked to "Acme"). **Query-relative.** |

### 2.1 The two graph layers

Social/User Proximity and Context Proximity are the same operation (BFS over entity edges) distinguished by **what they measure from**:

- **Social/User Proximity** is anchored on **you** — *"how close is this to me, in general?"* Stable; doesn't change per query.
- **Context Proximity** is anchored on **now** — *"how related is this to what I'm doing right now?"* Changes every turn.

There is intentionally **no generic "graph distance."** A graph distance is meaningless without an anchor; these two are the only anchors worth measuring from. When an item is both close to you *and* tied to the current topic, both fire — that is correct (it is doubly relevant), so each weight is kept individually modest.

---

## 3. Importance by entity category

Default emphasis per dimension for the four core entity kinds. These qualitative levels seed the per-type default **weights**; exact numbers are tuned against the eval suite (`/innovate`), not hand-set here.

Legend: **●●●** primary · **●●** secondary · **●** minor · **—** not used

| Layer | Human | Thing | Place | Event/Task |
|---|:--:|:--:|:--:|:--:|
| **Temporal** | — | ● *(seasonal)* | — | ●●● |
| **Semantic** | ●● | ●●● | ●● | ●● |
| **Spatial** | ● | — | ●●● | ●● |
| **Social / User Proximity** | ●●● | ● | ● | ●● |
| **Goal Alignment** | ● | ●● | — | ●●● |
| **Behavioral** | ●●● | ●● | ●● | ● |
| **Recency** | ●● | ●● | ● | ●● |
| **Context Proximity** | ●● | ●●● | ● | ●● |

Each category has a clear identity down its column:

- **Human** → closeness-to-you and interaction frequency (Social + Behavioral), then who's relevant now.
- **Thing** (notes, docs, projects) → content match and graph-linkage to current work (Semantic + Context), serving goals.
- **Place** → physical distance and how often you go (Spatial + Behavioral).
- **Event/Task** → its time window first, then goal service; the most multi-dimensional kind.

---

## 4. The temporal salience curve

Temporal is a **graded score**, not a binary filter. Salience genuinely follows a curve — anticipation rises before a dated item, peaks during it, and decays after — so a flat in/out window with a hard cliff (day 14 fully relevant, day 15 gone) is wrong.

### 4.1 Shape: fixed trapezoid, tunable ramps

The curve is a **piecewise-linear trapezoid** keyed to the node's timestamps. The *shape* is fixed; only the ramp **widths** vary (via `windowBefore` / `windowAfter`).

```
salience
 1 ┤          ┌────────────┐
   │         ╱  (the item)   ╲
   │        ╱                  ╲
   │       ╱                    ╲____
 0 ┤──────┘                          ╲─────
   └───────┼──────┼────────┼─────┼────┼────→  time
        relStart start    end  relEnd  archiveAfter
        (start−    │        │   (end+    (relEnd+
         before)   │        │   after)   archiveDelay)
                   └ plateau ┘
```

- **0** before `relevanceStart` — too far out to care
- **attack:** ramp `relevanceStart → start`
- **plateau at 1.0** during `[start, end]` (for a point/no-end item, this collapses to a peak at `start`)
- **decay:** ramp `end → relevanceEnd`
- **tail to 0** at `archiveAfter`

We deliberately do **not** support per-node curve *functions* (linear vs exponential vs sigmoid). Against seven other dimensions in a weighted sum, ramp shape is sub-perceptual in ranking — it is false precision not worth the cost or non-determinism. Vary width, fix shape.

### 4.2 Filter = the curve's support

Because the curve is 0 before `relevanceStart` and after `archiveAfter`, **candidacy is simply "temporal score > 0."** There is no separate boolean window filter and no separate archive threshold — `archiveAfter` is exactly the moment salience reaches zero. This also unifies the two code paths: temporal types no longer bypass the scorer (today's `!typeConfig?.temporal` fork in `context-loop`), so Events/Tasks can finally benefit from Goal/Social/Context dimensions too.

### 4.3 Point vs. period: different decay

A past **event** cools (it happened); a past-due **task** gets *hotter* (overdue = more salient). The existing `anchor: 'point' | 'period'` config drives this:

- **`period` (event):** peak during `[start, end]`, then decay through `windowAfter`.
- **`point` (task / deadline):** ramp to peak at the due date, then **hold near-peak through `windowAfter`** (the overdue grace window) before decaying. An overdue task stays loud; it does not fade for `windowAfter` days.

### 4.4 Attack/decay are type-level parameters (with per-node override)

Different context types have different natural windows — a *vacation* becomes relevant weeks ahead; a *1:1* a day or two ahead. This variation is captured by **type-level defaults**, set **once** when the type is defined:

- `windowBefore` — attack width (days before `start` that salience begins rising)
- `windowAfter` — decay width (days after `end`/`start` that salience reaches 0, before the archive tail)
- `archiveDelay` — tail length after `relevanceEnd`

Per **node**, the create-time LLM call inherits the type defaults and **overrides only for outliers** (e.g. a wedding warranting a 90-day attack vs the generic event default). The override is a number added to a write the LLM is already making — never a separate request, never a curve. Most nodes inherit; consistency by default, intelligence where it matters.

### 4.5 `created` is excluded

The node's **creation date is not part of the temporal curve.** Created/updated freshness is the **Recency** dimension's job; folding it into Temporal would double-count. Temporal is anchored only on the *item's own dates* (start / end / window / archive).

### 4.6 Where the LLM cost lands

| Moment | Temporal LLM cost |
|---|---|
| Type creation (once) | Sets the type's default attack/decay. Paid once. |
| Entity creation (per write) | Inherits default; sets a custom window only when atypical — marginal tokens in an existing call. |
| Retrieval / scoring (per query) | **None.** Pure interpolation over stored dates. |

---

## 5. Scoring model

For a candidate node, the relevance score is a **weighted sum** of its active dimension signals, each in `[0, 1]`:

```
score(node) = Σ  weight[d] · signal[d](node)
            d ∈ active dimensions
```

- **Active dimensions** are those the context type declares in `dimensions[]`. Inactive dimensions contribute nothing.
- **Weights** are normalized to sum to 1.0 over the active set (so a type using three dimensions is comparable to one using six).
- **Per-query modulation:** `request-weights` shifts the type's baseline weights per request — a person-mention query amplifies Social Proximity, a future-dated query suppresses Recency, an analytical query boosts Semantic. The classifier infers these multipliers; they are applied over the structural defaults, then re-normalized.

Temporal participates in the weighted sum like any other dimension; its "filter" behavior is just its zero regions (§4.2).

---

## 6. Config model

### Per type (`EntityTypeConfig.dimensions: RelevanceDimensionDef[]`)

Each entry names a dimension, an optional weight, and a dimension-specific config. The canonical dimension set is exactly §2 — types opt into a subset:

- `temporal` — `{ anchor: 'point'|'period', startField, endField?, durationField?, windowBefore, windowAfter, archiveDelay? }`
- `semantic` — (no config; vector indexing is automatic)
- `spatial` — `{ coordinatesField, maxKm? }`
- `socialProximity` — `{ relationshipField?, weights? }` (me-anchored BFS is implicit; relationship weighting refines it)
- `goalAlignment` — `{ maxHops? }`
- `behavioral` — (no config)
- `recency` — `{ halfLifeDays? }`
- `contextProximity` — `{ maxHops?, followEdgeLabels? }`

### Per node (computed at write time, stored on the node)

`computeNodeDimensions()` resolves and stores the per-node dimension data (e.g. temporal `start` / `end` / `relevantStart` / `relevantEnd` / `archiveAfter`) so scoring reads precomputed values. Where a node overrides the type's window, the resolved bounds are stored on the node.

---

## 7. Migration status (v1 → v2)

This spec is the **v2 target.** As of 2026-06-13 the codebase is mid-migration:

- **v1 (live):** `RelevanceConfig` (`@deprecated`) drives `scoreNodes()` with a 9-signal model (incl. `coOccurrence`, `centrality` — **dropped in v2**). Temporal is a binary filter on a separate code path from scoring.
- **v2 (target, this doc):** `RelevanceDimensionDef[]` is the source of truth; the 8 dimensions above; temporal is a graded curve; `request-weights` is wired through the scorer; the temporal/scored code paths are unified.

Remaining work to complete v2: align the `RelevanceDimensionDef` enum to §2 (add `contextProximity`; confirm `goalAlignment` + `behavioral`; rename `graphDistance`→ split into social/context; `geographical`→`spatial`), make `scoreNodes`/`searchByRelevance` consume `dimensions[]` + `requestWeights`, implement the temporal curve (§4), set per-category default weights from §3, delete the v1 `RelevanceConfig` path, and add a `scoreNodes` unit test.
