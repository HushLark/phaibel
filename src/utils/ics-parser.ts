// ─────────────────────────────────────────────────────────────────────────────
// ICS PARSER
// Thin wrapper around node-ical that converts ICS VEVENT objects into
// CalendarEvent shape for the `cal sync` command.
// Uses node-ical's expandRecurringEvent to expand RRULE occurrences within
// the requested date window so recurring events (standups, weekly meetings, etc.)
// all get imported as individual vault entities.
// ─────────────────────────────────────────────────────────────────────────────

import ical, { type VEvent } from 'node-ical';

/** Extract a plain string from a node-ical ParameterValue (string | { val, params }). */
function str(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && 'val' in value) return String((value as { val: unknown }).val);
    return String(value ?? '');
}

export interface CalendarEvent {
    uid: string;           // Google Calendar event UID (for dedup)
    title: string;
    startDate: string;     // ISO datetime
    endDate: string;       // ISO datetime
    location?: string;
    description?: string;  // becomes entity body
}

/**
 * Parse raw ICS text into an array of CalendarEvents within [from, to].
 * Expands recurring events (RRULE) so each occurrence in the window becomes
 * its own CalendarEvent with a date-scoped UID.
 */
export function parseIcsFeed(
    icsText: string,
    from: Date = new Date(0),
    to: Date = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
): CalendarEvent[] {
    const parsed = ical.parseICS(icsText);
    const events: CalendarEvent[] = [];

    for (const key of Object.keys(parsed)) {
        const component = parsed[key];
        if (!component || component.type !== 'VEVENT') continue;

        const item = component as VEvent;

        // Skip cancelled events
        if (item.status && item.status.toUpperCase() === 'CANCELLED') continue;

        const uid = item.uid;
        if (!uid) continue;

        // Expand into instances (handles both single events and RRULE recurrences)
        let instances: Array<{ start: Date; end: Date; summary: unknown; event: VEvent }>;
        try {
            instances = ical.expandRecurringEvent(item, { from, to, includeOverrides: true, excludeExdates: true });
        } catch {
            // Fallback: treat as single event
            instances = item.start ? [{ start: item.start as Date, end: (item.end ?? item.start) as Date, summary: item.summary, event: item }] : [];
        }

        for (const instance of instances) {
            const { start, end, event } = instance;

            if (!start) continue;

            const startDate = start instanceof Date ? start.toISOString() : new Date(String(start)).toISOString();
            const endDate = end
                ? (end instanceof Date ? end.toISOString() : new Date(String(end)).toISOString())
                : startDate;

            // For recurring events, append the date to the UID so each occurrence
            // is stored as a separate vault entity without overwriting the others.
            const instanceUid = event.rrule
                ? `${uid}_${start.toISOString().slice(0, 10).replace(/-/g, '')}`
                : uid;

            const calEvent: CalendarEvent = {
                uid: instanceUid,
                title: str(event.summary || instance.summary) || '(Untitled)',
                startDate,
                endDate,
            };

            if (event.location) calEvent.location = str(event.location);
            if (event.description) calEvent.description = str(event.description).trim();

            events.push(calEvent);
        }
    }

    return events;
}
