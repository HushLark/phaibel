// ─────────────────────────────────────────────────────────────────────────────
// ICS PARSER
// Thin wrapper around node-ical that converts ICS VEVENT objects into
// CalendarEvent shape for the `cal sync` command.
// ─────────────────────────────────────────────────────────────────────────────
import ical from 'node-ical';
/** Extract a plain string from a node-ical ParameterValue (string | { val, params }). */
function str(value) {
    if (typeof value === 'string')
        return value;
    if (value && typeof value === 'object' && 'val' in value)
        return String(value.val);
    return String(value ?? '');
}
/**
 * Parse raw ICS text into an array of CalendarEvents.
 * Filters to VEVENTs only, skips cancelled events.
 */
export function parseIcsFeed(icsText) {
    const parsed = ical.parseICS(icsText);
    const events = [];
    for (const key of Object.keys(parsed)) {
        const component = parsed[key];
        if (!component || component.type !== 'VEVENT')
            continue;
        const item = component;
        // Skip cancelled events
        if (item.status && item.status.toUpperCase() === 'CANCELLED')
            continue;
        const uid = item.uid;
        if (!uid)
            continue;
        const title = str(item.summary) || '(Untitled)';
        const start = item.start;
        const end = item.end;
        if (!start)
            continue;
        // node-ical returns Date objects for both DATE and DATE-TIME values
        const startDate = start instanceof Date ? start.toISOString() : new Date(String(start)).toISOString();
        const endDate = end
            ? (end instanceof Date ? end.toISOString() : new Date(String(end)).toISOString())
            : startDate;
        const event = {
            uid,
            title,
            startDate,
            endDate,
        };
        if (item.location)
            event.location = str(item.location);
        if (item.description)
            event.description = str(item.description).trim();
        events.push(event);
    }
    return events;
}
