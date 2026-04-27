// ─────────────────────────────────────────────────────────────────────────────
// ENTITY DEDUP JOB
//
// Scans all entity types for duplicate files sharing the same entity id or
// calendarUid. Keeps the most recently updated copy and trashes the rest.
// Runs as a scheduled cron job; also useful after calendar sync or imports.
// ─────────────────────────────────────────────────────────────────────────────

import { loadEntityTypes } from '../../entities/entity-type-config.js';
import { listEntities, trashEntity } from '../../entities/entity.js';
import { getPlatform } from '../../platform/index.js';

export interface DedupResult {
    scanned: number;
    deduped: number;
}

type EntityList = { filepath: string; meta: Record<string, unknown>; content: string }[];

async function dedupOne(typeName: string): Promise<DedupResult> {
    const { storage } = getPlatform();
    let entities: EntityList;
    try {
        entities = await listEntities(typeName, { metaOnly: true });
    } catch {
        return { scanned: 0, deduped: 0 };
    }

    const byId  = new Map<string, EntityList>();
    const byUid = new Map<string, EntityList>();
    let scanned = 0;

    for (const ent of entities) {
        scanned++;
        const id = ent.meta.id as string | undefined;
        if (id) {
            if (!byId.has(id)) byId.set(id, []);
            byId.get(id)!.push(ent);
        }

        // calendarUid may be missing if body parse failed (e.g. multi-line location)
        let calUid = ent.meta.calendarUid as string | undefined;
        if (!calUid) {
            try {
                const raw = await storage.readFile(ent.filepath, 'utf-8');
                const m = raw.match(/^calendarUid:\s*(.+)$/m);
                if (m) calUid = m[1].trim();
            } catch { /* skip */ }
        }
        if (calUid) {
            if (!byUid.has(calUid)) byUid.set(calUid, []);
            byUid.get(calUid)!.push(ent);
        }
    }

    let deduped = 0;

    const trash = async (copies: EntityList) => {
        if (copies.length <= 1) return;
        const keeper = copies.reduce((a, b) =>
            String(a.meta.updated ?? '') >= String(b.meta.updated ?? '') ? a : b
        );
        for (const dup of copies) {
            if (dup.filepath === keeper.filepath) continue;
            try { await trashEntity(dup.filepath); deduped++; } catch { /* already gone */ }
        }
    };

    for (const copies of byId.values()) await trash(copies);
    // Only dedup by calendarUid when those entities weren't already caught by id dedup
    for (const copies of byUid.values()) {
        const stillAlive = copies.filter(e => {
            const id = e.meta.id as string | undefined;
            return !id || (byId.get(id)?.length ?? 0) <= 1;
        });
        await trash(stillAlive);
    }

    return { scanned, deduped };
}

/** Deduplicate a single entity type. Used by the calendar sync before building its UID map. */
export async function deduplicateEntityType(typeName: string): Promise<DedupResult> {
    return dedupOne(typeName);
}

/** Deduplicate all entity types. Used by the scheduled cron job. */
export async function deduplicateEntities(): Promise<DedupResult> {
    const types = await loadEntityTypes();
    let scanned = 0;
    let deduped = 0;
    for (const t of types) {
        const r = await dedupOne(t.name);
        scanned += r.scanned;
        deduped += r.deduped;
    }
    return { scanned, deduped };
}
