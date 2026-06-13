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

import type { TemporalConfig, TemporalDimensionConfig } from './entity-type-config.js';
import type { TemporalNodeDimension } from '../cxms/types.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// DIMENSION-BASED TEMPORAL FILTER (v2)
// Uses the pre-computed TemporalNodeDimension stored on the node.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the node falls within the relevance window defined by its
 * temporal dimension config and the node's pre-computed start/end dates.
 *
 * relevantStart = start − windowBefore
 * relevantEnd   = (anchor=period ? end : start) + windowAfter
 *
 * A node without a temporal dimension is always considered relevant.
 */
export function isNodeTemporallyRelevantByDimension(
    dim: TemporalNodeDimension | undefined,
    config: TemporalDimensionConfig,
    today = todayStr(),
): boolean {
    if (!dim) return true;

    const relevantStart = addDays(dim.start, -config.windowBefore);
    const windowBase    = dim.anchor === 'period' && dim.end ? dim.end : dim.start;
    const relevantEnd   = addDays(windowBase, config.windowAfter);

    return today >= relevantStart && today <= relevantEnd;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEMPORAL SALIENCE CURVE (v2)
// Graded [0,1] relevance over time — replaces the binary in/out window.
// See docs/RELEVANCE-DIMENSIONS.md §4.
//
// Fixed trapezoid; only the ramp widths vary (windowBefore/windowAfter, already
// baked into the pre-computed relevantStart/relevantEnd on the node):
//
//   0 before relevantStart → attack ramp → 1 across the peak → decay ramp → 0 at zero
//
//   period (event): peak plateau spans [start, end]; salience cools after the event.
//   point  (task):  peak plateau spans [start, relevantEnd] — an overdue task holds
//                   near-peak through its grace window, then decays.
//
// The curve's nonzero support is the candidacy filter: temporalSalience > 0 ⇔ in window.
// ─────────────────────────────────────────────────────────────────────────────

/** Whole-day number for a YYYY-MM-DD string (UTC midnight epoch days). */
function dayNumber(dateStr: string): number {
    return Math.floor(new Date(dateStr + 'T00:00:00Z').getTime() / 86_400_000);
}

/**
 * Graded temporal relevance in [0, 1] for a node, given today's date.
 *
 * A node with no temporal dimension is timeless → always 1.
 * Returns 0 once the node is fully outside its window (before relevantStart or
 * at/after the zero point), which is also the archival threshold.
 */
export function temporalSalience(
    dim: TemporalNodeDimension | undefined,
    today = todayStr(),
): number {
    if (!dim) return 1;

    const t = dayNumber(today);
    const start = dayNumber(dim.start);

    const riseStart = dayNumber(dim.relevantStart ?? dim.start);
    const peakStart = start;
    const peakEnd = dim.anchor === 'period'
        ? dayNumber(dim.end ?? dim.start)
        : dayNumber(dim.relevantEnd ?? dim.start); // point holds peak through overdue window
    const zero = dayNumber(dim.archiveAfter ?? dim.relevantEnd ?? dim.end ?? dim.start);

    // Clamp control points to a monotonic ordering in case of odd config.
    const a = riseStart;
    const b = Math.max(a, peakStart);
    const c = Math.max(b, peakEnd);
    const d = Math.max(c, zero);

    if (t < a) return 0;
    if (t < b) return (t - a) / (b - a);   // attack
    if (t <= c) return 1;                   // peak plateau
    if (t < d) return 1 - (t - c) / (d - c); // decay
    return 0;
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
