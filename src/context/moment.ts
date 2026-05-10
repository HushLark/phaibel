// ─────────────────────────────────────────────────────────────────────────────
// Moment Context — real-time "in the moment" variables for LLM context
//
// Computes current time, date, timezone, task urgency counts, and today's
// schedule from the entity index. Designed to be included in every LLM call.
// ─────────────────────────────────────────────────────────────────────────────

import { getEntityIndex } from '../entities/entity-index.js';

export interface MomentContext {
    current_date: string;           // YYYY-MM-DD
    current_time: string;           // HH:MM
    day_of_week: string;            // e.g. "Tuesday"
    current_datetime_iso: string;   // full ISO 8601 with timezone
    user_timezone: string;          // e.g. "America/Denver (UTC-06:00)"
    overdue_tasks: number;
    tasks_due_today: number;
    tasks_due_tomorrow: number;
    todays_schedule: string;        // brief summary of today's events
}

/**
 * Build the "in the moment" context variables.
 * Reads from the entity index (must be built) for task/event data.
 */
/** Format a Date as a local YYYY-MM-DD string (not UTC). */
function localDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Format a Date as HH:MM using local time. */
function localTimeStr(d: Date): string {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function buildMomentContext(userName?: string): MomentContext {
    const now = new Date();

    // Local date/time — use getFullYear/getMonth/etc., NOT toISOString() (which is UTC)
    const today = localDateStr(now);

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = localDateStr(tomorrow);

    const currentTime = localTimeStr(now);

    // Day of week
    const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });

    // Timezone offset (e.g. "-06:00")
    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const off = now.getTimezoneOffset();
    const sign = off <= 0 ? '+' : '-';
    const h = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
    const m = String(Math.abs(off) % 60).padStart(2, '0');
    const tzOffset = `${sign}${h}:${m}`;

    // Build ISO 8601 from LOCAL time components so the datetime is correct in the user's zone
    const sec = String(now.getSeconds()).padStart(2, '0');
    const isoWithTz = `${today}T${currentTime}:${sec}${tzOffset}`;

    // ── Task urgency from entity index ───────────────────────────────────
    const index = getEntityIndex();
    let overdueTasks = 0;
    let tasksDueToday = 0;
    let tasksDueTomorrow = 0;

    if (index.isBuilt) {
        const tasks = index.getNodes('task');
        for (const task of tasks) {
            const status = task.meta.status as string | undefined;
            if (status === 'done') continue;

            const dueDate = task.meta.dueDate as string | undefined;
            if (!dueDate) continue;

            const due = dueDate.slice(0, 10); // normalize to YYYY-MM-DD
            if (due < today) overdueTasks++;
            else if (due === today) tasksDueToday++;
            else if (due === tomorrowStr) tasksDueTomorrow++;
        }
    }

    // ── Today's schedule from events ─────────────────────────────────────
    let todaysSchedule = 'No events scheduled today.';

    if (index.isBuilt) {
        const events = index.getNodes('event');
        const todayEvents: { time: string; title: string }[] = [];

        for (const event of events) {
            const startDate = (event.meta.startDate as string) || '';
            if (!startDate) continue;

            // Parse the date and compare using local calendar date (not UTC)
            let eventLocalDate: string;
            let timePart: string;
            if (startDate.includes('T')) {
                const d = new Date(startDate);
                eventLocalDate = localDateStr(d);
                timePart = localTimeStr(d);
            } else {
                eventLocalDate = startDate.slice(0, 10);
                timePart = 'all-day';
            }

            if (eventLocalDate !== today) continue;
            todayEvents.push({ time: timePart, title: event.title });
        }

        if (todayEvents.length > 0) {
            todayEvents.sort((a, b) => a.time.localeCompare(b.time));
            const lines = todayEvents.map(e =>
                e.time === 'all-day' ? `${e.title} (all day)` : `${e.time} ${e.title}`
            );
            todaysSchedule = lines.join(', ');
        }
    }

    return {
        current_date: today,
        current_time: currentTime,
        day_of_week: dayOfWeek,
        current_datetime_iso: isoWithTz,
        user_timezone: `${userTimezone} (UTC${tzOffset})`,
        overdue_tasks: overdueTasks,
        tasks_due_today: tasksDueToday,
        tasks_due_tomorrow: tasksDueTomorrow,
        todays_schedule: todaysSchedule,
    };
}

/**
 * Serialize MomentContext into a formatted block for LLM prompts.
 */
export function formatMomentBlock(moment: MomentContext): string {
    const lines = [
        `- current_date: ${moment.current_date} (${moment.day_of_week})`,
        `- current_time: ${moment.current_time}`,
        `- current_datetime: ${moment.current_datetime_iso}`,
        `- timezone: ${moment.user_timezone}`,
        `- overdue_tasks: ${moment.overdue_tasks}`,
        `- tasks_due_today: ${moment.tasks_due_today}`,
        `- tasks_due_tomorrow: ${moment.tasks_due_tomorrow}`,
        `- todays_schedule: ${moment.todays_schedule}`,
    ];
    return lines.join('\n');
}

/**
 * Convert MomentContext to a Record<string, string> for the context tree globals.
 */
export function momentToGlobals(moment: MomentContext, userName: string): Record<string, string> {
    return {
        user_name: userName,
        current_date: `${moment.current_date} (${moment.day_of_week})`,
        current_time: moment.current_time,
        current_datetime: moment.current_datetime_iso,
        timezone: moment.user_timezone,
        overdue_tasks: String(moment.overdue_tasks),
        tasks_due_today: String(moment.tasks_due_today),
        tasks_due_tomorrow: String(moment.tasks_due_tomorrow),
        todays_schedule: moment.todays_schedule,
    };
}
