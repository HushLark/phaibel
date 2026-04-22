// ─────────────────────────────────────────────────────────────────────────────
// CxMS — Context Management System Types
// ─────────────────────────────────────────────────────────────────────────────
// Canonical v5 type definitions for the Context Management System.
// These types formalize the entity model as a tree of context types and nodes.
// ─────────────────────────────────────────────────────────────────────────────
/** Bridge: ContextType is the v5 name for EntityTypeConfig */
export function toContextType(etc) {
    return etc;
}
/**
 * Parse a shorthand reference string "label:context-type:node-id" into a ContextReference.
 */
export function parseReference(ref) {
    const parts = ref.split(':');
    if (parts.length !== 3)
        return null;
    return { label: parts[0], contextType: parts[1], nodeId: parts[2] };
}
/**
 * Format a ContextReference as shorthand "label:context-type:node-id".
 */
export function formatReference(ref) {
    return `${ref.label}:${ref.contextType}:${ref.nodeId}`;
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
