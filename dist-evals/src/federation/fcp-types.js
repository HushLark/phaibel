// ─────────────────────────────────────────────────────────────────────────────
// Federated Context Protocol (FCP) — Types & Schemas
//
// FCP is a narrow, two-verb protocol for querying context from remote sources:
//   1. POST /fcp/probe   — counts + titles only (cheap, cacheable)
//   2. POST /fcp/fetch   — full bodies for specific IDs (targeted)
//   3. GET  /fcp/manifest — source capabilities & scopes (discovery)
//
// Version 1. Backwards-compatible additions only.
// ─────────────────────────────────────────────────────────────────────────────
import { z } from 'zod';
export const FCP_VERSION = 1;
// ── Actor — who is asking ────────────────────────────────────────────────────
export const ActorSchema = z.object({
    /** Stable identifier of the calling agent, e.g. "phaibel:gary@clift-labs". */
    agent_id: z.string().min(1),
    /** Optional Ed25519 signature of the canonical request, base64-encoded. */
    signature: z.string().optional(),
    /** Optional public-key reference (for peer discovery). */
    pubkey: z.string().optional(),
});
// ── Probe — initial context query (ICQ) ─────────────────────────────────────
/**
 * Probe modes:
 *   keyword — full-text search using provided keywords (default)
 *   date    — return entities for a specific date or range (use time_range)
 *   todo    — return open tasks / action items
 *   latest  — return most recently created/updated entities
 */
export const ProbeModeSchema = z.enum(['keyword', 'date', 'todo', 'latest']);
export const ProbeQuerySchema = z.object({
    /** Probe mode — controls how the source interprets the request. Default: "keyword". */
    mode: ProbeModeSchema.default('keyword'),
    /** Extracted keywords (stop words already removed). Required for mode="keyword", ignored otherwise. */
    keywords: z.array(z.string().min(1)).max(32).default([]),
    /** Optional hints to narrow the search. */
    hints: z.object({
        entity_types: z.array(z.string()).optional(),
    }).optional(),
    /** Optional time range — ISO-8601 dates. Used for mode="date". */
    time_range: z.object({
        from: z.string().optional(),
        to: z.string().optional(),
    }).optional(),
    /** Max results to return. Used for mode="latest". Default: 10. */
    limit: z.number().int().positive().max(50).default(10),
});
export const ProbeBudgetSchema = z.object({
    /** Soft deadline for the source to respond. */
    max_latency_ms: z.number().int().positive().default(500),
    /** Cap the number of sample titles returned per type. */
    max_matches_per_type: z.number().int().positive().default(5),
});
export const ProbeRequestSchema = z.object({
    fcp_version: z.literal(1),
    query: ProbeQuerySchema,
    actor: ActorSchema,
    budget: ProbeBudgetSchema.optional(),
});
export const ProbeMatchSampleSchema = z.object({
    id: z.string(),
    title: z.string(),
    /** Relevance score 0..1. Source-specific ranking. */
    score: z.number().min(0).max(1),
});
export const ProbeMatchSchema = z.object({
    type: z.string(),
    count: z.number().int().nonnegative(),
    samples: z.array(ProbeMatchSampleSchema),
});
export const ProbeResponseSchema = z.object({
    fcp_version: z.literal(1),
    source: z.string(),
    source_trust: z.enum(['own', 'team', 'peer', 'public']).optional(),
    probed_at: z.string(),
    ttl_seconds: z.number().int().nonnegative().default(300),
    matches: z.array(ProbeMatchSchema),
    token_estimate: z.object({
        probe: z.number().int().nonnegative(),
        fetch_full: z.number().int().nonnegative(),
    }).optional(),
});
// ── Fetch — full context query (FCQ) ────────────────────────────────────────
export const FetchDetailSchema = z.enum(['summary', 'full']);
export const FetchRequestSchema = z.object({
    fcp_version: z.literal(1),
    /** IDs previously returned by /fcp/probe samples. */
    ids: z.array(z.string().min(1)).min(1).max(100),
    detail: FetchDetailSchema.default('full'),
    actor: ActorSchema,
    /** Free-text purpose string — used for audit logs. */
    purpose: z.string().max(200).optional(),
});
export const FetchedNodeSchema = z.object({
    id: z.string(),
    type: z.string(),
    title: z.string(),
    summary: z.string().optional(),
    body: z.string().optional(),
    meta: z.record(z.unknown()).optional(),
    links: z.array(z.object({
        type: z.string(),
        id: z.string(),
        relation: z.string().optional(),
    })).optional(),
});
export const FetchResponseSchema = z.object({
    fcp_version: z.literal(1),
    source: z.string(),
    nodes: z.array(FetchedNodeSchema),
    /** IDs the actor is not authorized to see. */
    denied_ids: z.array(z.string()).default([]),
    /** True if the response was truncated (too many results). */
    truncated: z.boolean().default(false),
});
// ── Manifest — discovery ────────────────────────────────────────────────────
export const ManifestSchema = z.object({
    fcp_version: z.literal(1),
    /** Source identifier — must match the `source` in probe/fetch responses. */
    source: z.string(),
    /** Human-readable name. */
    name: z.string(),
    /** Entity types this source exposes. */
    entity_types: z.array(z.string()),
    /** Scopes supported — callers must request within these. */
    scopes: z.array(z.string()),
    /** Authentication methods accepted. */
    auth_methods: z.array(z.enum(['bearer', 'signed', 'none'])),
    /** Default trust tier this source self-declares. */
    trust: z.enum(['own', 'team', 'peer', 'public']),
    /** Optional contact info for operators. */
    contact: z.string().optional(),
});
// ── Source Registry (client-side config) ────────────────────────────────────
export const SourceConfigSchema = z.object({
    /** Stable source ID — matches Manifest.source. */
    id: z.string(),
    /** Base URL — endpoints are {url}/probe, {url}/fetch, {url}/manifest. */
    url: z.string().url(),
    /** Human-readable description of what this source contains, e.g. "Employee directory". */
    description: z.string().optional(),
    /** Access mode — read: probe/fetch only; readwrite: can also create/update/delete nodes. */
    mode: z.enum(['read', 'readwrite']).default('read'),
    /** Trust tier assigned locally — may differ from source's self-declared trust. */
    trust: z.enum(['own', 'team', 'peer', 'public']),
    /** Authentication config. */
    auth: z.object({
        type: z.enum(['bearer', 'signed', 'none']),
        token_ref: z.string().optional(), // secrets key, not the token itself
        pubkey_ref: z.string().optional(),
    }),
    /** Whitelist of entity types to probe. Empty = all. */
    scopes: z.array(z.string()).default([]),
    /** Disable without deleting the entry. */
    enabled: z.boolean().default(true),
});
export const SourceRegistrySchema = z.object({
    sources: z.array(SourceConfigSchema),
});
