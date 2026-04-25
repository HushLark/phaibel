// ─────────────────────────────────────────────────────────────────────────────
// TEMPORAL FILTER
// Utilities for applying a context type's window of importance to entity nodes.
//
// Each context type with a TemporalConfig defines:
//   - Which field holds the date/datetime anchor
//   - How many days before/after that date the node is considered relevant
//   - How many days after the anchor date the node should be archived
//
// A node with no date value is always treated as relevant (no date = timeless).
// ─────────────────────────────────────────────────────────────────────────────

import type { TemporalConfig } from './entity-type-config.js';

// ─────────────────────────────────────────────────────────────────────────────
// DATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Extract YYYY-MM-DD from any date, datetime, or ISO string. */
function toDateStr(val: unknown): string {
    return String(val ?? '').split('T')[0];
}

/** Add (or subtract) days from a YYYY-MM-DD string. Returns YYYY-MM-DD. */
export function addDays(dateStr: string, days: number): string {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split('T')[0];
}

/** Today's date as YYYY-MM-DD in local time. */
export function todayStr(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

export interface WindowBounds {
    /** First date (inclusive) that falls within the window — YYYY-MM-DD */
    from: string;
    /** Last date (inclusive) that falls within the window — YYYY-MM-DD */
    to: string;
}

/**
 * Compute the inclusive date window [from, to] for a context type relative to today.
 *
 *   from = today − windowDaysBefore
 *   to   = today + windowDaysAfter
 */
export function getWindowBounds(temporal: TemporalConfig, today = todayStr()): WindowBounds {
    return {
        from: addDays(today, -temporal.windowDaysBefore),
        to:   addDays(today,  temporal.windowDaysAfter),
    };
}

/**
 * Extract the anchor date string (YYYY-MM-DD) from a node's metadata.
 * Returns null if the field is absent or empty.
 */
export function getNodeAnchorDate(
    meta: Record<string, unknown>,
    temporal: TemporalConfig,
): string | null {
    const val = meta[temporal.field];
    if (!val) return null;
    const s = toDateStr(val);
    return s.length === 10 ? s : null;
}

/**
 * Returns true if the node falls within its type's window of importance.
 *
 * A node with no anchor date is always considered relevant — it has no
 * temporal constraint so it should never be excluded by the filter.
 */
export function isNodeTemporallyRelevant(
    meta: Record<string, unknown>,
    temporal: TemporalConfig,
    today = todayStr(),
): boolean {
    const anchor = getNodeAnchorDate(meta, temporal);
    if (!anchor) return true;
    const { from, to } = getWindowBounds(temporal, today);
    return anchor >= from && anchor <= to;
}

/**
 * Returns true if the node has passed its archive threshold.
 *
 * Condition: anchor + deleteAfterDays < today
 *
 * Returns false if deleteAfterDays is not set on the type (no auto-archive).
 * Returns false if the node has no anchor date.
 */
export function shouldArchiveNode(
    meta: Record<string, unknown>,
    temporal: TemporalConfig,
    today = todayStr(),
): boolean {
    if (temporal.deleteAfterDays === undefined) return false;
    const anchor = getNodeAnchorDate(meta, temporal);
    if (!anchor) return false;
    const archiveAfter = addDays(anchor, temporal.deleteAfterDays);
    return archiveAfter < today;
}

/**
 * Filter a list of entity metadata records to only those within the
 * type's window of importance.  Records without an anchor date pass through.
 */
export function filterByTemporalWindow<T extends Record<string, unknown>>(
    records: T[],
    temporal: TemporalConfig,
    today = todayStr(),
): T[] {
    const { from, to } = getWindowBounds(temporal, today);
    return records.filter(meta => {
        const anchor = getNodeAnchorDate(meta, temporal);
        if (!anchor) return true;
        return anchor >= from && anchor <= to;
    });
}

/**
 * Partition records into two groups: those to archive and those to keep.
 * Only applies to types with deleteAfterDays set.
 */
export function partitionForArchive<T extends Record<string, unknown>>(
    records: T[],
    temporal: TemporalConfig,
    today = todayStr(),
): { archive: T[]; keep: T[] } {
    if (temporal.deleteAfterDays === undefined) {
        return { archive: [], keep: records };
    }
    const archive: T[] = [];
    const keep: T[] = [];
    for (const rec of records) {
        if (shouldArchiveNode(rec, temporal, today)) {
            archive.push(rec);
        } else {
            keep.push(rec);
        }
    }
    return { archive, keep };
}
