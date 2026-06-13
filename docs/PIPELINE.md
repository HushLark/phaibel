# Request Pipeline

**Status:** Reference (canonical)
**Last updated:** 2026-06-13
**Implementation:** `src/commands/chat.ts` (`feralChatHeadless`), `src/context/`, `src/cxms/`, `src/feral/`, `src/llm/`

How Phaibel turns one user message into a response, step by step, and which
component each step uses. See also `docs/RELEVANCE-DIMENSIONS.md` (step 7) and
`CLAUDE.md` (architecture overview).

---

## Components

| Component | Role |
|---|---|
| **CxMS** | The context store. Vault/Foundation reader, moment context, entity index, the relevance scorer (which itself uses the Embedding index, Behavioral index, and entity graph), and the write-time dimension calculator. **Deterministic.** |
| **Embedding index** | Per-node vectors (local MiniLM model). Computed at write time; a cosine lookup at query time. |
| **Behavioral index** | Per-node interaction counters. Deterministic. |
| **Classifier** | `request-classifier` — one fast LLM call that extracts category, subjects, timeframes, attributes. |
| **Request weights** | `request-weights` — rule-based per-dimension multipliers from the classification. **Deterministic.** |
| **Feral engine** | Bootstraps the node catalog and executes the process DAG. |
| **LLM router** | Maps a capability (`categorize` / `reason` / `chat`) to a provider + model. |

The LLM capability per step matters: cheap/fast work (`categorize`) vs. heavy
reasoning (`reason`) vs. the personality-bearing reply (`chat`).

---

## The two paths

Phaibel has a **fast path** and a **full custom pipeline**, chosen by the
classifier's category:

- **Fast path** — when the category maps to a prebuilt Feral process
  (`CATEGORY_PROCESS_KEY`), Phaibel does deterministic CxMS retrieval and goes
  straight to synthesis. **2 LLM calls total** (classify + synthesize).
- **Full custom pipeline** — otherwise, the multi-phase LLM pipeline builds and
  runs a bespoke process. **Up to ~5 LLM calls** (classify, reuse-match, node
  selection, process generation, completion check) **+ synthesis**.

Both share steps 0–4; the fast path short-circuits 6–11.

---

## Steps

| # | Step | Component(s) | LLM? |
|---|------|--------------|------|
| 0 | **Transcribe audio** (voice input only) | web-server → Whisper | ✅ Whisper (OpenAI) |
| 1 | **Bootstrap + load vault context** | Feral bootstrap; CxMS reader (`getVaultContext`) | — deterministic |
| 2 | **Classify request** (category, subjects, timeframes, attributes) | Classifier | ✅ `categorize` |
| 3 | **Infer request weights** (per-dimension multipliers) | Request weights | — deterministic |
| 4 | **Build moment context** (today, overdue, schedule) | CxMS (`buildMomentContext`) | — deterministic |
| 5 | **Fast-path dispatch** *(only if category has a prebuilt process)* | CxMS retrieval + relevance → jump to step 12 | — deterministic (skips 6–11) |
| 6 | **Phase 0/1 — process reuse match** (reuse a saved process vs. build custom) | LLM router + Feral catalog | ✅ `categorize` |
| 7 | **Gather context** (`fetchContextByClassification`) | **CxMS + relevance scorer** (Embedding + Behavioral + graph) | — deterministic, **0 LLM** |
| 8 | **Phase 4 — node selection** (choose catalog nodes) | LLM router + Feral catalog | ✅ `categorize` |
| 9 | **Phase 5 — process generation** (emit Feral process JSON) | LLM router | ✅ `reason` |
| 10 | **Execute process** (run the DAG: entity CRUD, HTTP, formatting…) | **Feral engine + CxMS** (entity ops) | — deterministic |
| 11 | **Phase 7 — completion check** (done vs. iterate → back to 9) | LLM router | ✅ `categorize` (may loop) |
| 12 | **Synthesize response** (applies personality / identity) | LLM router + `createSystemPrompt` | ✅ `chat` |
| 13 | **Judge** *(eval harness only — not production)* | LLM router | ✅ `categorize` |

Find each phase's prompt by its grep anchor (not line number — `chat.ts` drifts):
`You are the process matcher for Phaibel` (6), `Select the minimal set of catalog nodes` (8),
`Generate a valid Feral process JSON` (9), `You are a task completion checker for Phaibel` (11),
`const synthesisPrompt =` (12). Base/personality prompt: `createSystemPrompt` in `src/llm/router.ts`.

---

## The determinism boundary

This is the load-bearing design line:

- **Context *selection* is deterministic.** Steps 1, 3, 4, 7, 10 — including the
  entire relevance layer (step 7) — run with zero LLM and no randomness. Given
  the same vault state and clock, they produce the same result.
- **Only *classification* and *generation/synthesis* touch the LLM** — steps 2,
  6, 8, 9, 11, 12 (and transcription, 0).

So retrieval is reproducible and free; the model is spent on understanding the
request and writing the reply, not on choosing what context to load.

---

## The write path (separate from request handling)

When an entity is created or updated (inside step 10, or via the API), CxMS does
two things up front so query-time scoring stays cheap and LLM-free:

1. **`computeNodeDimensions`** precomputes the node's relevance-dimension data —
   temporal window bounds (`relevantStart` / `relevantEnd` / `archiveAfter`),
   spatial coordinates, relationship — and stores it on the node. Deterministic.
2. **The Embedding index** computes the node's vector via the local MiniLM model.

The per-node data the relevance scorer reads at query time (step 7) is therefore
built once, at write time — never recomputed during retrieval.
