// ─────────────────────────────────────────────────────────────────────────────
// Annual Date Resolver
//
// Resolves date-fixed (MM-DD) and date-floating (named/rule) field values
// to actual calendar dates for a given year. Used by the calendar API and
// web client to surface upcoming birthdays, holidays, and recurring dates.
// ─────────────────────────────────────────────────────────────────────────────

export interface AnnualDateItem {
    entityId: string;
    entityType: string;
    title: string;
    fieldKey: string;
    fieldLabel: string;
    date: string;           // YYYY-MM-DD resolved for the current/next occurrence
    daysAway: number;       // positive = future, 0 = today, negative = past (within window)
    recurrenceType: 'date-fixed' | 'date-floating';
    rule: string;           // original MM-DD or rule string
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'];

export function resolveFixedDate(mmdd: string, year: number): Date | null {
    const parts = mmdd.split('-');
    if (parts.length !== 2) return null;
    const mm = parseInt(parts[0], 10);
    const dd = parseInt(parts[1], 10);
    if (isNaN(mm) || isNaN(dd) || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    const d = new Date(year, mm - 1, dd);
    if (d.getMonth() !== mm - 1) return null; // rolled over (e.g. Feb 30)
    return d;
}

export function resolveFloatingDate(rule: string, year: number): Date | null {
    // Named constants
    switch (rule) {
        case 'easter':             return computeEaster(year);
        case 'thanksgiving-us':    return nthWeekday(4, 4, 10, year); // 4th Thursday of November (month=10)
        case 'memorial-day-us':    return lastWeekday(1, 4, year);    // last Monday of May (month=4)
        case 'labor-day-us':       return nthWeekday(1, 1, 8, year);  // 1st Monday of September (month=8)
        case 'mothers-day-us':     return nthWeekday(2, 0, 4, year);  // 2nd Sunday of May (month=4)
        case 'fathers-day-us':     return nthWeekday(3, 0, 5, year);  // 3rd Sunday of June (month=5)
    }

    // Custom rule: "{ordinal|last}-{weekday}-{month}"
    const parts = rule.split('-');
    if (parts.length < 3) return null;
    const monthName = parts[parts.length - 1];
    const weekdayName = parts[parts.length - 2];
    const ordinalStr = parts.slice(0, parts.length - 2).join('-');

    const monthIdx = MONTHS.indexOf(monthName);
    const weekdayIdx = WEEKDAYS.indexOf(weekdayName);
    if (monthIdx === -1 || weekdayIdx === -1) return null;

    if (ordinalStr === 'last') return lastWeekday(weekdayIdx, monthIdx, year);
    const n = parseInt(ordinalStr, 10);
    if (isNaN(n) || n < 1 || n > 5) return null;
    return nthWeekday(n, weekdayIdx, monthIdx, year);
}

/** Returns upcoming annual date items within windowDays from today. */
export function upcomingAnnualDates(
    entities: Array<{ id: string; type: string; title: string; meta: Record<string, unknown> }>,
    typeFieldMap: Record<string, Array<{ key: string; label?: string; type: string }>>,
    windowDays = 365,
): AnnualDateItem[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayYMD = ymd(today);
    const results: AnnualDateItem[] = [];

    for (const entity of entities) {
        const fields = typeFieldMap[entity.type] ?? [];
        for (const field of fields) {
            if (field.type !== 'date-fixed' && field.type !== 'date-floating') continue;
            const value = entity.meta[field.key];
            if (typeof value !== 'string' || !value) continue;

            const item = resolveNextOccurrence(
                entity.id, entity.type, entity.title,
                field.key, field.label ?? field.key,
                value, field.type as 'date-fixed' | 'date-floating',
                today, todayYMD, windowDays,
            );
            if (item) results.push(item);
        }
    }

    return results.sort((a, b) => a.daysAway - b.daysAway);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveNextOccurrence(
    entityId: string, entityType: string, title: string,
    fieldKey: string, fieldLabel: string,
    rule: string, recurrenceType: 'date-fixed' | 'date-floating',
    today: Date, todayYMD: string, windowDays: number,
): AnnualDateItem | null {
    const year = today.getFullYear();
    const resolve = recurrenceType === 'date-fixed'
        ? (y: number) => resolveFixedDate(rule, y)
        : (y: number) => resolveFloatingDate(rule, y);

    for (const y of [year, year + 1]) {
        const d = resolve(y);
        if (!d) break;
        const dYMD = ymd(d);
        const daysAway = Math.round((d.getTime() - today.getTime()) / 86400000);
        if (daysAway >= 0 && daysAway <= windowDays) {
            return { entityId, entityType, title, fieldKey, fieldLabel, date: dYMD, daysAway, recurrenceType, rule };
        }
        if (y === year && dYMD < todayYMD) continue; // already passed this year, try next
        break;
    }
    return null;
}

function ymd(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** nth occurrence of a weekday in a month (1-indexed n, 0=Sun weekday, 0-indexed month). */
function nthWeekday(n: number, weekday: number, month: number, year: number): Date | null {
    const d = new Date(year, month, 1);
    const first = d.getDay();
    let day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
    const result = new Date(year, month, day);
    if (result.getMonth() !== month) return null; // n-th doesn't exist this month
    return result;
}

/** Last occurrence of a weekday in a month. */
function lastWeekday(weekday: number, month: number, year: number): Date {
    const lastDay = new Date(year, month + 1, 0);
    const diff = (lastDay.getDay() - weekday + 7) % 7;
    return new Date(year, month, lastDay.getDate() - diff);
}

/** Computus algorithm for Easter (Gregorian). */
function computeEaster(year: number): Date {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month, day);
}
