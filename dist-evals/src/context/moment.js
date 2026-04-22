// ─────────────────────────────────────────────────────────────────────────────
// Moment Context — real-time "in the moment" variables for LLM context
//
// Computes current time, date, timezone, task urgency counts, and today's
// schedule from the entity index. Designed to be included in every LLM call.
// ─────────────────────────────────────────────────────────────────────────────
import { getEntityIndex } from '../entities/entity-index.js';
/**
 * Build the "in the moment" context variables.
 * Reads from the entity index (must be built) for task/event data.
 */
export function buildMomentContext(userName) {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    // Tomorrow's date
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    // Time
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const currentTime = `${hours}:${minutes}`;
    // Day of week
    const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
    // Timezone
    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const off = now.getTimezoneOffset();
    const sign = off <= 0 ? '+' : '-';
    const h = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
    const m = String(Math.abs(off) % 60).padStart(2, '0');
    const tzOffset = `${sign}${h}:${m}`;
    // Full ISO 8601 with timezone offset
    const isoWithTz = now.toISOString().replace('Z', tzOffset);
    // ── Task urgency from entity index ───────────────────────────────────
    const index = getEntityIndex();
    let overdueTasks = 0;
    let tasksDueToday = 0;
    let tasksDueTomorrow = 0;
    if (index.isBuilt) {
        const tasks = index.getNodes('task');
        for (const task of tasks) {
            const status = task.meta.status;
            if (status === 'done')
                continue;
            const dueDate = task.meta.dueDate;
            if (!dueDate)
                continue;
            const due = dueDate.slice(0, 10); // normalize to YYYY-MM-DD
            if (due < today)
                overdueTasks++;
            else if (due === today)
                tasksDueToday++;
            else if (due === tomorrowStr)
                tasksDueTomorrow++;
        }
    }
    // ── Today's schedule from events ─────────────────────────────────────
    let todaysSchedule = 'No events scheduled today.';
    if (index.isBuilt) {
        const events = index.getNodes('event');
        const todayEvents = [];
        for (const event of events) {
            const startDate = event.meta.startDate || '';
            if (!startDate)
                continue;
            // Check if event falls on today (compare date portion)
            const eventDate = startDate.slice(0, 10);
            if (eventDate !== today)
                continue;
            // Extract time for display
            const timePart = startDate.includes('T')
                ? startDate.slice(11, 16) // HH:MM
                : 'all-day';
            todayEvents.push({ time: timePart, title: event.title });
        }
        if (todayEvents.length > 0) {
            todayEvents.sort((a, b) => a.time.localeCompare(b.time));
            const lines = todayEvents.map(e => e.time === 'all-day' ? `${e.title} (all day)` : `${e.time} ${e.title}`);
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
export function formatMomentBlock(moment) {
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
export function momentToGlobals(moment, userName) {
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
