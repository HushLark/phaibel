// ─────────────────────────────────────────────────────────────────────────────
// CxMS — Context Management System Types
// ─────────────────────────────────────────────────────────────────────────────
// Canonical v5 type definitions for the Context Management System.
// These types formalize the entity model as a tree of context types and nodes.
// ─────────────────────────────────────────────────────────────────────────────

import type { FieldDef, FieldType, EntityTypeConfig, SpawnerConfig, RelevanceDimensionDef } from '../entities/entity-type-config.js';

// Re-export foundation types
export type { FieldDef, FieldType, SpawnerConfig, RelevanceDimensionDef };

// ── Relevance Dimensions (stored on nodes) ───────────────────────────────────

export interface TemporalNodeDimension {
    anchor: 'point' | 'period';
    /** Primary anchor date (YYYY-MM-DD or ISO datetime) */
    start: string;
    /** Period end date (YYYY-MM-DD or ISO datetime) — period only */
    end?: string;
    /** Pre-computed relevance-window start (YYYY-MM-DD): start − windowBefore. Salience attack begins here. */
    relevantStart?: string;
    /** Pre-computed relevance-window end (YYYY-MM-DD): (end|start) + windowAfter. Salience decay completes here. */
    relevantEnd?: string;
    /** Pre-computed archive date (YYYY-MM-DD): relevantEnd + archiveDelay. Salience reaches 0 here. */
    archiveAfter?: string;
}

export interface SemanticNodeDimension {
    /** Whether the node has been indexed for semantic search */
    indexed: boolean;
    /** ISO timestamp of last indexing */
    indexedAt?: string;
}

export interface SocialProximityNodeDimension {
    /** Relationship type read from the configured field (refines me-anchored graph distance) */
    relationship: string;
}

export interface SpatialNodeDimension {
    lat: number;
    lng: number;
}

export interface RecencyNodeDimension {
    /** ISO timestamp of last update */
    updatedAt: string;
}

export interface NodeDimensions {
    temporal?: TemporalNodeDimension;
    semantic?: SemanticNodeDimension;
    socialProximity?: SocialProximityNodeDimension;
    spatial?: SpatialNodeDimension;
    recency?: RecencyNodeDimension;
}

// ── Context Type ─────────────────────────────────────────────────────────────

/**
 * A Context Type defines a branch in the CxMS tree.
 * Each type has a schema, description, and examples.
 * Nodes within the type must validate against the schema.
 */
export interface ContextType {
    /** System name (lowercase, alphanumeric, hyphens). e.g. "calendar-event" */
    name: string;
    /** Plural display name. e.g. "calendar events" */
    plural: string;
    /** Directory path relative to foundation root. e.g. "context-types/calendar-event" */
    directory: string;
    /** Human-readable description of this type */
    description?: string;
    /** Default tags applied to new nodes */
    defaultTags?: string[];
    /** Schema fields that nodes must validate against */
    fields: FieldDef[];
    /** Field used to mark completion (e.g. 'status') */
    completionField?: string;
    /** Value that marks completion (e.g. 'done') */
    completionValue?: string;
    /** Spawner config for generating child nodes */
    spawner?: SpawnerConfig;
    /** Field used for calendar/timeline placement */
    calendarDateField?: string;
    /** Relevance dimension definitions for this type */
    dimensions?: RelevanceDimensionDef[];
}

/** Bridge: ContextType is the v5 name for EntityTypeConfig */
export function toContextType(etc: EntityTypeConfig): ContextType {
    return etc as ContextType;
}

// ── Context Node ─────────────────────────────────────────────────────────────

/**
 * A Context Node is a leaf in the CxMS tree — actual data stored as
 * markdown with YAML frontmatter.
 */
export interface ContextNodeMeta {
    /** 8 alphanumeric character unique ID */
    id: string;
    /** Human-readable title */
    title: string;
    /** Context type this node belongs to */
    contextType: string;
    /** ISO 8601 creation timestamp */
    created: string;
    /** ISO 8601 last-updated timestamp */
    updated?: string;
    /** Tags for cross-referencing */
    tags: string[];
    /** LLM-generated one-sentence summary (max 150 chars) */
    summary?: string;
    /** How this node was created */
    source?: 'user' | 'assumed' | 'system';
    /** Labeled references to other nodes */
    references?: ContextReference[];
    /** Pre-computed relevance dimensions */
    dimensions?: NodeDimensions;
    /** Additional fields defined by the context type schema */
    [key: string]: unknown;
}

/**
 * A full context node with metadata and markdown body content.
 */
export interface ContextNode {
    meta: ContextNodeMeta;
    content: string;
    filepath?: string;
}

// ── Context References ───────────────────────────────────────────────────────

/**
 * A labeled reference from one context node to another.
 * Stored in frontmatter as: `references: [{label, contextType, nodeId}]`
 * Shorthand format: "label:context-type:node-id"
 */
export interface ContextReference {
    /** Relationship label (e.g. "spouse", "depends-on", "connecting-flight") */
    label: string;
    /** Target context type */
    contextType: string;
    /** Target node ID (8 alphanumeric chars) */
    nodeId: string;
}

/**
 * Parse a shorthand reference string "label:context-type:node-id" into a ContextReference.
 */
export function parseReference(ref: string): ContextReference | null {
    const parts = ref.split(':');
    if (parts.length !== 3) return null;
    return { label: parts[0], contextType: parts[1], nodeId: parts[2] };
}

/**
 * Format a ContextReference as shorthand "label:context-type:node-id".
 */
export function formatReference(ref: ContextReference): string {
    return `${ref.label}:${ref.contextType}:${ref.nodeId}`;
}

// ── Presentation Dates ───────────────────────────────────────────────────────

/**
 * Presentation dates control when a node appears on the user's
 * timeline or calendar.
 *
 * - date: A calendar day (YYYY-MM-DD). e.g. Easter 2026.
 * - datetime: A moment in time (ISO 8601 with timezone). e.g. meeting at 2pm.
 * - duration: How long it lasts (ISO 8601 duration). e.g. PT2H for 2 hours.
 */
export interface PresentationDate {
    /** Calendar date (YYYY-MM-DD) */
    date?: string;
    /** Specific date and time (ISO 8601 with timezone) */
    datetime?: string;
    /** Duration (ISO 8601: PnYnMnDTnHnMnS) */
    duration?: string;
}

// ── Collections ──────────────────────────────────────────────────────────────

/**
 * A Collection is a simple key/value pair list stored as a markdown file.
 * e.g. "types of people", "types of transportation"
 */
export interface Collection {
    /** System name (filename without .md) */
    name: string;
    /** Description from frontmatter */
    description?: string;
    /** Key/value items */
    items: Record<string, string>;
}

// ── Foundation Hierarchy ─────────────────────────────────────────────────────

/**
 * The Foundation is the root directory of a Phaibel system.
 * Marker file: .phaibel.md
 *
 * Structure:
 *   (Root)/.phaibel.md                    — Root context
 *   (Root)/profiles/                      — User and agent profiles
 *   (Root)/context-types/                 — Context type branches
 *   (Root)/context-types/mapping.json     — Type registry
 *   (Root)/context-types/{type}/          — Type directory
 *   (Root)/context-types/{type}/.phaibel.md       — Type context
 *   (Root)/context-types/{type}/.phaibel-examples.md — Examples
 *   (Root)/collections/                   — Key/value collections
 *   (Root)/logs/                          — Access logs
 *   (Root)/feral/                         — Feral CCF engine
 *   (Root)/phaibel-cxms.oa3              — OpenAPI spec
 */
export const FOUNDATION_MARKER = '.phaibel.md';
export const LEGACY_VAULT_MARKER = '.vault.md';
