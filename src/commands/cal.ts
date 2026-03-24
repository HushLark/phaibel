// ─────────────────────────────────────────────────────────────────────────────
// CAL COMMAND
// Google Calendar ICS feed sync — read-only, one-way: Google Calendar → Phaibel.
// Supports multiple named calendar feeds.
// ─────────────────────────────────────────────────────────────────────────────

import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import { promises as fsPromises } from 'fs';
import { loadConfig, saveConfig } from '../config.js';
import { getCalConfigPath, getVaultConfigDir } from '../paths.js';
import { getVaultRoot } from '../state/manager.js';
import { parseIcsFeed } from '../utils/ics-parser.js';
import {
    ensureEntityDir,
    writeEntity,
    listEntities,
    generateEntityId,
    createEntityMeta,
    entityFilename,
} from '../entities/entity.js';
import { getEntityType, addEntityType } from '../entities/entity-type-config.js';
import { getEntityIndex } from '../entities/entity-index.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export interface CalendarEntry {
    id: string;
    name: string;
    url: string;
}

export interface CalConfig {
    calendars: CalendarEntry[];
}

/** Load config, auto-migrating legacy single-URL format. */
export async function loadCalConfig(): Promise<CalConfig> {
    try {
        const configPath = await getCalConfigPath();
        const raw = await fsPromises.readFile(configPath, 'utf-8');
        const parsed = JSON.parse(raw);

        // Migrate legacy format: { calendarUrl: "..." } → { calendars: [...] }
        if (parsed.calendarUrl && !parsed.calendars) {
            const migrated: CalConfig = {
                calendars: [{ id: 'default', name: 'Default', url: parsed.calendarUrl }],
            };
            await saveCalConfig(migrated);
            return migrated;
        }

        return { calendars: parsed.calendars ?? [] };
    } catch {
        return { calendars: [] };
    }
}

export async function saveCalConfig(cfg: CalConfig): Promise<void> {
    const dir = await getVaultConfigDir();
    await fsPromises.mkdir(dir, { recursive: true });
    const configPath = await getCalConfigPath();
    await fsPromises.writeFile(configPath, JSON.stringify(cfg, null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// ENSURE EVENT ENTITY TYPE
// ─────────────────────────────────────────────────────────────────────────────

async function ensureEventType(): Promise<void> {
    const existing = await getEntityType('event');
    if (existing) return;

    await addEntityType({
        name: 'event',
        plural: 'events',
        directory: 'events',
        description: 'Calendar events and scheduled activities',
        fields: [
            { key: 'startDate', type: 'datetime', label: 'Start', required: true },
            { key: 'endDate', type: 'datetime', label: 'End', required: true },
            { key: 'location', type: 'string', label: 'Location' },
            { key: 'calendarUid', type: 'string', label: 'Calendar UID' },
            { key: 'calendarId', type: 'string', label: 'Calendar ID' },
            { key: 'status', type: 'enum', label: 'Status', values: ['confirmed', 'tentative', 'cancelled'], default: 'confirmed' },
        ],
    });
    console.log(chalk.gray('  Auto-registered "event" entity type.'));
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBCOMMANDS
// ─────────────────────────────────────────────────────────────────────────────

export const calCommand = new Command('calendar')
    .alias('cal')
    .description('Manage calendar feeds (Google Calendar ICS sync)');

// ── add ───────────────────────────────────────────────────────────────────────

calCommand
    .command('add <name> <url>')
    .description('Add a new calendar feed')
    .action(async (name: string, url: string) => {
        const cfg = await loadCalConfig();
        const id = name.toLowerCase().replace(/[^a-z0-9-_]/g, '-');

        if (cfg.calendars.some(c => c.id === id)) {
            console.log(chalk.yellow(`\n  A calendar with id "${id}" already exists, sir.`));
            console.log(chalk.gray(`  Use ${chalk.bold(`phaibel cal set-url ${id} <url>`)} to update it.\n`));
            return;
        }

        cfg.calendars.push({ id, name, url });
        await saveCalConfig(cfg);
        console.log(chalk.green(`\n  Calendar "${name}" (${id}) added, sir.`));
        console.log(chalk.gray(`  Run ${chalk.bold('phaibel cal sync')} to pull events.\n`));
    });

// ── remove ────────────────────────────────────────────────────────────────────

calCommand
    .command('remove <name>')
    .description('Remove a calendar feed')
    .action(async (name: string) => {
        const cfg = await loadCalConfig();
        const idx = cfg.calendars.findIndex(c => c.id === name || c.name === name);

        if (idx === -1) {
            console.log(chalk.yellow(`\n  No calendar found with id or name "${name}", sir.\n`));
            return;
        }

        const removed = cfg.calendars.splice(idx, 1)[0];
        await saveCalConfig(cfg);
        console.log(chalk.green(`\n  Calendar "${removed.name}" (${removed.id}) removed, sir.\n`));
    });

// ── list ──────────────────────────────────────────────────────────────────────

calCommand
    .command('list')
    .description('Show all configured calendars')
    .action(async () => {
        const cfg = await loadCalConfig();

        if (cfg.calendars.length === 0) {
            console.log(chalk.yellow('\n  No calendars configured.'));
            console.log(chalk.gray(`  Use ${chalk.bold('phaibel cal add <name> <url>')} to add one.\n`));
            return;
        }

        console.log(chalk.cyan('\n  Configured calendars:\n'));
        for (const cal of cfg.calendars) {
            const masked = cal.url.length > 50 ? cal.url.slice(0, 50) + '...' : cal.url;
            console.log(`    ${chalk.bold(cal.name)} ${chalk.gray(`(${cal.id})`)}`);
            console.log(`    ${chalk.gray(masked)}\n`);
        }
    });

// ── set-url ───────────────────────────────────────────────────────────────────

calCommand
    .command('set-url <name> <url>')
    .description('Update the URL for an existing calendar')
    .action(async (name: string, url: string) => {
        const cfg = await loadCalConfig();
        const cal = cfg.calendars.find(c => c.id === name || c.name === name);

        if (!cal) {
            console.log(chalk.yellow(`\n  No calendar found with id or name "${name}", sir.\n`));
            return;
        }

        cal.url = url;
        await saveCalConfig(cfg);
        console.log(chalk.green(`\n  URL updated for "${cal.name}" (${cal.id}), sir.`));
        console.log(chalk.gray(`  Run ${chalk.bold('phaibel cal sync')} to pull events.\n`));
    });

// ─────────────────────────────────────────────────────────────────────────────
// HEADLESS SYNC (reusable from cron scheduler and CLI)
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncCalendarResult {
    created: number;
    updated: number;
    unchanged: number;
}

/**
 * Sync one calendar feed into the vault.
 */
async function syncOneCalendar(
    cal: CalendarEntry,
    daysAhead: number,
): Promise<SyncCalendarResult> {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const horizon = new Date(startOfToday.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    // 1. Fetch ICS feed
    const res = await fetch(cal.url);
    if (!res.ok) {
        throw new Error(`Failed to fetch feed for "${cal.name}": ${res.status} ${res.statusText}`);
    }
    const icsText = await res.text();

    // 2. Parse
    const allEvents = parseIcsFeed(icsText);

    // 3. Filter to date window
    const upcoming = allEvents.filter(ev => {
        const start = new Date(ev.startDate);
        return start >= startOfToday && start <= horizon;
    });

    // 4. Build UID map scoped to this calendar (or legacy events with no calendarId)
    const existingEntities = await listEntities('event');
    const uidMap = new Map<string, { filepath: string; meta: Record<string, unknown>; content: string }>();
    for (const ent of existingEntities) {
        const uid = ent.meta.calendarUid as string | undefined;
        const entCalId = ent.meta.calendarId as string | undefined;
        if (uid && (entCalId === cal.id || !entCalId)) {
            uidMap.set(uid, ent);
        }
    }

    // 5. Sync
    const eventsDir = await ensureEntityDir('event');
    const index = getEntityIndex();
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const ev of upcoming) {
        const existing = uidMap.get(ev.uid);

        if (existing) {
            const meta = existing.meta;
            const changed =
                meta.startDate !== ev.startDate ||
                meta.endDate !== ev.endDate ||
                (meta.location || '') !== (ev.location || '') ||
                (meta.title as string) !== ev.title;

            if (changed) {
                meta.title = ev.title;
                meta.startDate = ev.startDate;
                meta.endDate = ev.endDate;
                meta.location = ev.location;
                // Stamp calendarId on legacy events during update
                if (!meta.calendarId) meta.calendarId = cal.id;
                const body = ev.description || existing.content;
                await writeEntity(existing.filepath, meta, body);

                if (index.isBuilt) {
                    const eventId = meta.id as string;
                    await index.addOrUpdate('event', eventId, ev.title, existing.filepath);
                }
                updated++;
            } else {
                unchanged++;
            }
        } else {
            const baseMeta = createEntityMeta('event', ev.title, {
                tags: ['calendar'],
            });

            const meta: Record<string, unknown> = {
                ...baseMeta,
                startDate: ev.startDate,
                endDate: ev.endDate,
                location: ev.location,
                calendarUid: ev.uid,
                calendarId: cal.id,
                status: 'confirmed',
            };

            const filepath = path.join(eventsDir, entityFilename(ev.title, baseMeta.id));
            const body = ev.description || '';
            await writeEntity(filepath, meta, body);

            if (index.isBuilt) {
                await index.addOrUpdate('event', baseMeta.id, ev.title, filepath);
            }
            created++;
        }
    }

    return { created, updated, unchanged };
}

/**
 * Sync calendar events from ICS feed(s) into the vault.
 * Headless — no console output. Throws on fatal errors.
 *
 * @param opts.calendarId - sync only this calendar; omit to sync all
 * @param opts.days - number of days ahead to sync (default: 60)
 */
export async function syncCalendar(opts?: { days?: number; calendarId?: string }): Promise<SyncCalendarResult> {
    const cfg = await loadCalConfig();

    if (cfg.calendars.length === 0) {
        throw new Error('No calendars configured. Use "phaibel cal add <name> <url>" first.');
    }

    await ensureEventType();

    const daysAhead = opts?.days ?? 60;

    // Determine which calendars to sync
    let targets: CalendarEntry[];
    if (opts?.calendarId) {
        const cal = cfg.calendars.find(c => c.id === opts.calendarId || c.name === opts.calendarId);
        if (!cal) {
            throw new Error(`No calendar found with id or name "${opts.calendarId}".`);
        }
        targets = [cal];
    } else {
        targets = cfg.calendars;
    }

    // Sync each calendar, aggregate results
    const totals: SyncCalendarResult = { created: 0, updated: 0, unchanged: 0 };
    for (const cal of targets) {
        const result = await syncOneCalendar(cal, daysAhead);
        totals.created += result.created;
        totals.updated += result.updated;
        totals.unchanged += result.unchanged;
    }

    return totals;
}

// ── sync ────────────────────────────────────────────────────────────────────

calCommand
    .command('sync [name]')
    .description('Fetch ICS feed(s) and sync events into the vault')
    .option('--days <n>', 'Number of days ahead to sync (default: 60)', '60')
    .action(async (name: string | undefined, opts: { days: string }) => {
        const daysAhead = parseInt(opts.days, 10) || 60;

        if (name) {
            console.log(chalk.gray(`\n  Syncing calendar "${name}"...`));
        } else {
            console.log(chalk.gray('\n  Syncing all calendars...'));
        }

        try {
            const result = await syncCalendar({ days: daysAhead, calendarId: name });
            console.log(chalk.green(`\n  Sync complete: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged.\n`));
        } catch (err) {
            console.log(chalk.red(`\n  ${err instanceof Error ? err.message : err}\n`));
        }
    });

export default calCommand;
