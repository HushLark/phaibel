// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULED DELETE JOB
//
// Scans all entity types for entities with a deleteDate (or deleteAt) field
// whose value is in the past, and moves them to the vault trash.
//
// This lets users (or agents) schedule a future deletion on any entity by
// setting deleteDate: YYYY-MM-DD or deleteAt: YYYY-MM-DDTHH:mm:ssZ.
//
// Runs daily via the cron scheduler. Safe to re-run: already-trashed entities
// are gone and won't be seen again.
// ─────────────────────────────────────────────────────────────────────────────

import { loadEntityTypes } from '../../entities/entity-type-config.js';
import { listEntities, trashEntity } from '../../entities/entity.js';
import { debug } from '../../utils/debug.js';

/** Field names checked for a scheduled delete datetime, in priority order. */
const DELETE_FIELDS = ['deleteDate', 'deleteAt', 'expiresAt'];

export interface ScheduledDeleteResult {
    scanned: number;
    deleted: number;
    errors: number;
    details: Array<{ type: string; title: string; deleteDate: string }>;
}

function resolveDeleteField(meta: Record<string, unknown>): { field: string; value: string } | null {
    for (const key of DELETE_FIELDS) {
        const raw = meta[key];
        if (raw === undefined || raw === null || raw === '') continue;
        return { field: key, value: String(raw) };
    }
    return null;
}

function isPast(dateStr: string, now: Date): boolean {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    // Date-only values (no time) are treated as end-of-day in local time
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim());
    if (isDateOnly) {
        const endOfDay = new Date(dateStr + 'T23:59:59');
        return endOfDay < now;
    }
    return d < now;
}

/**
 * Trash all entities with a past deleteDate / deleteAt / expiresAt field.
 */
export async function runScheduledDelete(): Promise<ScheduledDeleteResult> {
    const result: ScheduledDeleteResult = {
        scanned: 0,
        deleted: 0,
        errors: 0,
        details: [],
    };

    const now = new Date();
    const types = await loadEntityTypes();

    for (const t of types) {
        let entities: Awaited<ReturnType<typeof listEntities>>;
        try {
            entities = await listEntities(t.name);
        } catch (err) {
            debug('scheduled-delete', `Failed to list ${t.name}: ${err}`);
            result.errors++;
            continue;
        }

        for (const entity of entities) {
            result.scanned++;
            const resolved = resolveDeleteField(entity.meta);
            if (!resolved) continue;
            if (!isPast(resolved.value, now)) continue;

            const title = String(entity.meta.title ?? entity.meta.name ?? entity.meta.id ?? 'unknown');
            try {
                await trashEntity(entity.filepath);
                result.deleted++;
                result.details.push({ type: t.name, title, deleteDate: resolved.value });
                debug('scheduled-delete', `Trashed ${t.name}/${title} (${resolved.field}: ${resolved.value})`);
            } catch (err) {
                debug('scheduled-delete', `Failed to trash ${entity.filepath}: ${err}`);
                result.errors++;
            }
        }
    }

    return result;
}
