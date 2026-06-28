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
    trashEntity,
} from '../entities/entity.js';
import { getPlatform } from '../platform/index.js';
import { getEntityType, addEntityType } from '../entities/entity-type-config.js';
import { getEntityIndex } from '../entities/entity-index.js';
import { deduplicateEntityType } from '../service/cron/entity-dedup.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export interface CalendarEntry {
    id: string;
    name: string;
    url: string;
    windowDaysPast?: number;    // days before today to retain (default: 14)
    windowDaysFuture?: number;  // days ahead to fetch (default: 90)
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
    pruned: number;
}

const DEFAULT_WINDOW_PAST = 14;    // days
const DEFAULT_WINDOW_FUTURE = 90;  // days

/**
 * Sync one calendar feed into the vault, then prune events outside the retention window.
 */
async function syncOneCalendar(cal: CalendarEntry): Promise<SyncCalendarResult> {
    const daysPast   = cal.windowDaysPast   ?? DEFAULT_WINDOW_PAST;
    const daysFuture = cal.windowDaysFuture ?? DEFAULT_WINDOW_FUTURE;

    const now = new Date();
    const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysPast);
    const windowEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysFuture);

    // 1. Fetch ICS feed
    const res = await fetch(cal.url);
    if (!res.ok) {
        throw new Error(`Failed to fetch feed for "${cal.name}": ${res.status} ${res.statusText}`);
    }
    const icsText = await res.text();

    // 2. Parse — pass the full window so recurring events expand correctly
    const eventsInWindow = parseIcsFeed(icsText, windowStart, windowEnd);

    // 3. Dedup first so the UID map is built from a clean slate (no collision from prior runs).
    await deduplicateEntityType('event');

    // 4. Build UID map scoped to this calendar (or legacy events with no calendarId).
    //    Falls back to raw file regex for entities whose body parse failed (e.g. multi-line
    //    location fields that break parseEntityBody). Tracks all entities per UID for dedup.
    const existingEntities = await listEntities('event', { metaOnly: true });
    const { storage } = getPlatform();
    const uidMap = new Map<string, { filepath: string; meta: Record<string, unknown>; content: string }>();

    for (const ent of existingEntities) {
        let uid = ent.meta.calendarUid as string | undefined;
        const entCalId = (ent.meta.calendarId as string | undefined);

        // If calendarUid is missing (body parse failed due to multi-line field values),
        // grep the raw file so we can still find the entity in the UID map.
        if (!uid) {
            try {
                const raw = await storage.readFile(ent.filepath, 'utf-8');
                const uidMatch = raw.match(/^calendarUid:\s*(.+)$/m);
                if (uidMatch) {
                    uid = uidMatch[1].trim();
                    ent.meta.calendarUid = uid;
                    // Restore other domain fields that were lost due to parse failure
                    const startM = raw.match(/^startDate:\s*(.+)$/m);
                    const endM   = raw.match(/^endDate:\s*(.+)$/m);
                    const locM   = raw.match(/^location:\s*(.+)$/m);
                    const calIdM = raw.match(/^calendarId:\s*(.+)$/m);
                    if (startM) ent.meta.startDate = startM[1].trim();
                    if (endM)   ent.meta.endDate   = endM[1].trim();
                    if (locM)   ent.meta.location  = locM[1].trim();
                    if (calIdM) { ent.meta.calendarId = calIdM[1].trim(); }
                }
            } catch { /* unreadable file — skip */ }
        }

        if (!uid) continue;
        const effectiveCalId = (ent.meta.calendarId as string | undefined);
        if (effectiveCalId !== cal.id && effectiveCalId !== undefined) continue;

        // Keep the most recently updated entity for each UID
        const existing = uidMap.get(uid);
        if (!existing || String(ent.meta.updated ?? '') >= String(existing.meta.updated ?? '')) {
            uidMap.set(uid, ent);
        }
    }

    // 5. Sync — upsert events within the window
    const eventsDir = await ensureEntityDir('event');
    const index = getEntityIndex();
    let created = 0, updated = 0, unchanged = 0;
    const syncedUids = new Set<string>();

    for (const ev of eventsInWindow) {
        syncedUids.add(ev.uid);
        const existing = uidMap.get(ev.uid);

        if (existing) {
            const meta = existing.meta;
            const changed =
                meta.startDate !== ev.startDate ||
                meta.endDate !== ev.endDate ||
                (meta.location || '') !== (ev.location || '') ||
                JSON.stringify(meta.attendees || []) !== JSON.stringify(ev.attendees || []) ||
                (meta.title as string) !== ev.title;

            if (changed) {
                meta.title = ev.title;
                meta.startDate = ev.startDate;
                meta.endDate = ev.endDate;
                meta.location = ev.location;
                if (ev.attendees && ev.attendees.length) meta.attendees = ev.attendees;
                else delete meta.attendees;
                if (!meta.calendarId) meta.calendarId = cal.id;
                const body = ev.description || existing.content;
                await writeEntity(existing.filepath, meta, body);
                if (index.isBuilt) await index.addOrUpdate('event', meta.id as string, ev.title, existing.filepath);
                updated++;
            } else {
                unchanged++;
            }
        } else {
            const baseMeta = createEntityMeta('event', ev.title);
            const meta: Record<string, unknown> = {
                ...baseMeta,
                startDate: ev.startDate,
                endDate: ev.endDate,
                location: ev.location,
                calendarUid: ev.uid,
                calendarId: cal.id,
                status: 'confirmed',
                ...(ev.attendees && ev.attendees.length ? { attendees: ev.attendees } : {}),
            };
            const filepath = path.join(eventsDir, entityFilename(ev.title, baseMeta.id));
            await writeEntity(filepath, meta, ev.description || '');
            if (index.isBuilt) await index.addOrUpdate('event', baseMeta.id, ev.title, filepath);
            created++;
        }
    }

    // 6. Prune — trash vault events for this calendar that are outside the window
    let pruned = 0;
    for (const ent of existingEntities) {
        const entCalId = ent.meta.calendarId as string | undefined;
        if (entCalId !== cal.id && entCalId !== undefined) continue; // different calendar
        const uid = ent.meta.calendarUid as string | undefined;
        if (!uid) continue; // not a calendar-imported event

        const startDate = ent.meta.startDate as string | undefined;
        if (!startDate) continue;

        const eventStart = new Date(startDate);
        const outsideWindow = eventStart < windowStart || eventStart > windowEnd;

        if (outsideWindow) {
            try {
                await trashEntity(ent.filepath);
                if (index.isBuilt) index.remove?.('event', ent.meta.id as string);
                pruned++;
            } catch {
                // If trash fails (already gone, etc.) continue without crashing
            }
        }
    }

    return { created, updated, unchanged, pruned };
}

/**
 * Sync calendar events from ICS feed(s) into the vault.
 * Headless — no console output. Throws on fatal errors.
 *
 * @param opts.calendarId - sync only this calendar; omit to sync all
 * @param opts.days - number of days ahead to sync (default: 60)
 */
export async function syncCalendar(opts?: { calendarId?: string }): Promise<SyncCalendarResult> {
    const cfg = await loadCalConfig();

    if (cfg.calendars.length === 0) {
        throw new Error('No calendars configured. Use "phaibel cal add <name> <url>" first.');
    }

    await ensureEventType();

    let targets: CalendarEntry[];
    if (opts?.calendarId) {
        const cal = cfg.calendars.find(c => c.id === opts.calendarId || c.name === opts.calendarId);
        if (!cal) throw new Error(`No calendar found with id or name "${opts.calendarId}".`);
        targets = [cal];
    } else {
        targets = cfg.calendars;
    }

    const totals: SyncCalendarResult = { created: 0, updated: 0, unchanged: 0, pruned: 0 };
    for (const cal of targets) {
        const result = await syncOneCalendar(cal);
        totals.created   += result.created;
        totals.updated   += result.updated;
        totals.unchanged += result.unchanged;
        totals.pruned    += result.pruned;
    }

    return totals;
}

// ── sync ────────────────────────────────────────────────────────────────────

calCommand
    .command('sync [name]')
    .description('Fetch ICS feed(s) and sync events into the vault, pruning events outside the retention window')
    .action(async (name: string | undefined) => {
        if (name) {
            console.log(chalk.gray(`\n  Syncing calendar "${name}"...`));
        } else {
            console.log(chalk.gray('\n  Syncing all calendars...'));
        }

        try {
            const result = await syncCalendar({ calendarId: name });
            const pruneNote = result.pruned > 0 ? `, ${result.pruned} pruned` : '';
            console.log(chalk.green(`\n  Sync complete: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged${pruneNote}.\n`));
        } catch (err) {
            console.log(chalk.red(`\n  ${err instanceof Error ? err.message : err}\n`));
        }
    });

// ── set-window ────────────────────────────────────────────────────────────────

calCommand
    .command('set-window <name>')
    .description('Set the retention window for a calendar (days past / days future)')
    .option('--past <n>', `Days before today to keep (default: ${DEFAULT_WINDOW_PAST})`)
    .option('--future <n>', `Days ahead to fetch (default: ${DEFAULT_WINDOW_FUTURE})`)
    .action(async (name: string, opts: { past?: string; future?: string }) => {
        const cfg = await loadCalConfig();
        const cal = cfg.calendars.find(c => c.id === name || c.name === name);
        if (!cal) { console.log(chalk.yellow(`\n  No calendar found with id or name "${name}", sir.\n`)); return; }
        if (opts.past   !== undefined) cal.windowDaysPast   = parseInt(opts.past,   10);
        if (opts.future !== undefined) cal.windowDaysFuture = parseInt(opts.future, 10);
        await saveCalConfig(cfg);
        console.log(chalk.green(`\n  Window updated for "${cal.name}": past=${cal.windowDaysPast ?? DEFAULT_WINDOW_PAST}d, future=${cal.windowDaysFuture ?? DEFAULT_WINDOW_FUTURE}d.\n`));
    });

export default calCommand;
