// ─────────────────────────────────────────────────────────────────────────────
// Current-time source
// ─────────────────────────────────────────────────────────────────────────────
//
// Single point of truth for "now" on the date-resolution paths (the moment
// block, temporal filtering, annual-date resolution). Honors the PHAIBEL_NOW
// env override — an ISO 8601 datetime — so the eval harness and debugging can
// PIN the clock and get deterministic relative-date behavior ("tomorrow",
// "next Tuesday at 2pm") regardless of when the run happens. Falls back to the
// real clock when unset or unparseable.
//
// Deliberately NOT used for perf timers, log timestamps, or entity
// created/updated stamps — those want real wall-clock time.

export function now(): Date {
    if (typeof process !== 'undefined' && process.env?.PHAIBEL_NOW) {
        const pinned = new Date(process.env.PHAIBEL_NOW);
        if (!isNaN(pinned.getTime())) return pinned;
    }
    return new Date();
}
