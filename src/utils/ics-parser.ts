// ─────────────────────────────────────────────────────────────────────────────
// ICS PARSER
// Thin wrapper around node-ical that converts ICS VEVENT objects into
// CalendarEvent shape for the `cal sync` command.
// Uses node-ical's expandRecurringEvent to expand RRULE occurrences within
// the requested date window so recurring events (standups, weekly meetings, etc.)
// all get imported as individual vault entities.
// ─────────────────────────────────────────────────────────────────────────────

import ical, { type VEvent } from 'node-ical';
import { htmlToMarkdown } from './html-to-markdown.js';

/** Convert a Date to an ISO 8601 string in the local timezone (e.g. 2026-05-06T12:30:00-06:00). */
function toLocalIso(d: Date): string {
    const off = d.getTimezoneOffset();
    const sign = off <= 0 ? '+' : '-';
    const oh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
    const om = String(Math.abs(off) % 60).padStart(2, '0');
    const tz = `${sign}${oh}:${om}`;
    const Y = d.getFullYear();
    const M = String(d.getMonth() + 1).padStart(2, '0');
    const D = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${Y}-${M}-${D}T${h}:${min}:${s}${tz}`;
}

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
    attendees?: string[];  // display names / emails from ATTENDEE lines (if present)
}

// ATTENDEE/ORGANIZER can be a string, an object { val, params:{ CN } }, or an
// array of either. Prefer the CN (display name), else the email.
function parseAttendees(raw: unknown): string[] {
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    const names = arr.map((a): string => {
        if (typeof a === 'string') return a.replace(/^mailto:/i, '').trim();
        const obj = a as { val?: string; params?: { CN?: string } };
        const cn = obj?.params?.CN;
        if (cn) return String(cn).trim();
        return obj?.val ? String(obj.val).replace(/^mailto:/i, '').trim() : '';
    }).filter(Boolean);
    return Array.from(new Set(names));
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

            const startDate = start instanceof Date ? toLocalIso(start) : toLocalIso(new Date(String(start)));
            const endDate = end
                ? (end instanceof Date ? toLocalIso(end) : toLocalIso(new Date(String(end))))
                : startDate;

            // For recurring events, append the date to the UID so each occurrence
            // is stored as a separate vault entity without overwriting the others.
            // Check both the instance's event and the outer item for rrule — expandRecurringEvent
            // sometimes returns instances where event.rrule is stripped.
            const instanceUid = (item.rrule || event.rrule)
                ? `${uid}_${start.toISOString().slice(0, 10).replace(/-/g, '')}`
                : uid;

            const calEvent: CalendarEvent = {
                uid: instanceUid,
                title: str(event.summary || instance.summary) || '(Untitled)',
                startDate,
                endDate,
            };

            // Normalize location to a single line — multi-line locations break the body field parser
            if (event.location) calEvent.location = str(event.location).replace(/\r?\n/g, ', ').replace(/,\s*,/g, ',').trim();
            // Calendar descriptions are often HTML (Google/Outlook) — normalize to
            // Markdown so the block renderer displays them correctly.
            if (event.description) calEvent.description = htmlToMarkdown(str(event.description)).trim();
            const attendees = parseAttendees((event as { attendee?: unknown }).attendee);
            if (attendees.length) calEvent.attendees = attendees;

            events.push(calEvent);
        }
    }

    return events;
}
