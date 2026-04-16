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
export type Actor = z.infer<typeof ActorSchema>;

// ── Probe — initial context query (ICQ) ─────────────────────────────────────

export const ProbeQuerySchema = z.object({
    /** Extracted keywords (stop words already removed by caller). */
    keywords: z.array(z.string().min(1)).min(1).max(32),
    /** Optional hints to narrow the search. */
    hints: z.object({
        entity_types: z.array(z.string()).optional(),
    }).optional(),
    /** Optional time range — ISO-8601 dates. */
    time_range: z.object({
        from: z.string().optional(),
        to: z.string().optional(),
    }).optional(),
});
export type ProbeQuery = z.infer<typeof ProbeQuerySchema>;

export const ProbeBudgetSchema = z.object({
    /** Soft deadline for the source to respond. */
    max_latency_ms: z.number().int().positive().default(500),
    /** Cap the number of sample titles returned per type. */
    max_matches_per_type: z.number().int().positive().default(5),
});
export type ProbeBudget = z.infer<typeof ProbeBudgetSchema>;

export const ProbeRequestSchema = z.object({
    fcp_version: z.literal(1),
    query: ProbeQuerySchema,
    actor: ActorSchema,
    budget: ProbeBudgetSchema.optional(),
});
export type ProbeRequest = z.infer<typeof ProbeRequestSchema>;

export const ProbeMatchSampleSchema = z.object({
    id: z.string(),
    title: z.string(),
    /** Relevance score 0..1. Source-specific ranking. */
    score: z.number().min(0).max(1),
});
export type ProbeMatchSample = z.infer<typeof ProbeMatchSampleSchema>;

export const ProbeMatchSchema = z.object({
    type: z.string(),
    count: z.number().int().nonnegative(),
    samples: z.array(ProbeMatchSampleSchema),
});
export type ProbeMatch = z.infer<typeof ProbeMatchSchema>;

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
export type ProbeResponse = z.infer<typeof ProbeResponseSchema>;

// ── Fetch — full context query (FCQ) ────────────────────────────────────────

export const FetchDetailSchema = z.enum(['summary', 'full']);
export type FetchDetail = z.infer<typeof FetchDetailSchema>;

export const FetchRequestSchema = z.object({
    fcp_version: z.literal(1),
    /** IDs previously returned by /fcp/probe samples. */
    ids: z.array(z.string().min(1)).min(1).max(100),
    detail: FetchDetailSchema.default('full'),
    actor: ActorSchema,
    /** Free-text purpose string — used for audit logs. */
    purpose: z.string().max(200).optional(),
});
export type FetchRequest = z.infer<typeof FetchRequestSchema>;

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
export type FetchedNode = z.infer<typeof FetchedNodeSchema>;

export const FetchResponseSchema = z.object({
    fcp_version: z.literal(1),
    source: z.string(),
    nodes: z.array(FetchedNodeSchema),
    /** IDs the actor is not authorized to see. */
    denied_ids: z.array(z.string()).default([]),
    /** True if the response was truncated (too many results). */
    truncated: z.boolean().default(false),
});
export type FetchResponse = z.infer<typeof FetchResponseSchema>;

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
export type Manifest = z.infer<typeof ManifestSchema>;

// ── Source Registry (client-side config) ────────────────────────────────────

export const SourceConfigSchema = z.object({
    /** Stable source ID — matches Manifest.source. */
    id: z.string(),
    /** Base URL — endpoints are {url}/probe, {url}/fetch, {url}/manifest. */
    url: z.string().url(),
    /** Trust tier assigned locally — may differ from source's self-declared trust. */
    trust: z.enum(['own', 'team', 'peer', 'public']),
    /** Authentication config. */
    auth: z.object({
        type: z.enum(['bearer', 'signed', 'none']),
        token_ref: z.string().optional(),    // secrets key, not the token itself
        pubkey_ref: z.string().optional(),
    }),
    /** Whitelist of entity types to probe. Empty = all. */
    scopes: z.array(z.string()).default([]),
    /** Disable without deleting the entry. */
    enabled: z.boolean().default(true),
});
export type SourceConfig = z.infer<typeof SourceConfigSchema>;

export const SourceRegistrySchema = z.object({
    sources: z.array(SourceConfigSchema),
});
export type SourceRegistry = z.infer<typeof SourceRegistrySchema>;
