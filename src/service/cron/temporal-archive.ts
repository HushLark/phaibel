// ─────────────────────────────────────────────────────────────────────────────
// TEMPORAL ARCHIVE JOB
// Scans all context types with deleteAfterDays set and moves expired nodes
// to <vaultRoot>/.archive/<type-directory>/<filename>.
//
// "Archive" rather than delete — the node is preserved for reference but
// removed from active context assembly and CxMS queries.
//
// Runs daily via the cron scheduler. Safe to re-run: already-archived nodes
// are not touched again.
// ─────────────────────────────────────────────────────────────────────────────

import { join, basename } from 'path';
import { promises as fs } from 'fs';
import { loadEntityTypes } from '../../entities/entity-type-config.js';
import { listEntities } from '../../entities/entity.js';
import { shouldArchiveNode, todayStr } from '../../entities/temporal-filter.js';
import { getVaultRoot } from '../../state/manager.js';
import { debug } from '../../utils/debug.js';

export interface TemporalArchiveResult {
    archived: number;
    skipped: number;
    errors: number;
    details: Array<{ type: string; title: string; anchorDate: string }>;
}

/**
 * Move a single entity file to .archive/<type-dir>/<filename>.
 * Appends a timestamp suffix if a file with the same name already exists.
 */
async function archiveEntity(
    filepath: string,
    typeDirectory: string,
): Promise<string> {
    const vaultRoot = await getVaultRoot();
    const archiveDir = join(vaultRoot, '.archive', typeDirectory);
    await fs.mkdir(archiveDir, { recursive: true });

    const filename = basename(filepath);
    const stem = filename.replace(/\.md$/, '');
    let archivePath = join(archiveDir, filename);

    try {
        await fs.access(archivePath);
        // Collision — append timestamp
        const ts = Date.now();
        archivePath = join(archiveDir, `${stem}-${ts}.md`);
    } catch {
        // No collision — use original filename
    }

    await fs.rename(filepath, archivePath);
    debug('temporal-archive', `Archived ${filepath} → ${archivePath}`);
    return archivePath;
}

/**
 * Run the temporal archive sweep.
 * For every context type with temporal.deleteAfterDays, find nodes whose
 * anchor date has passed the threshold and move them to .archive/.
 */
export async function runTemporalArchive(): Promise<TemporalArchiveResult> {
    const result: TemporalArchiveResult = {
        archived: 0,
        skipped: 0,
        errors: 0,
        details: [],
    };

    const today = todayStr();
    const types = await loadEntityTypes();

    for (const t of types) {
        if (!t.temporal?.deleteAfterDays) continue;

        let entities: Awaited<ReturnType<typeof listEntities>>;
        try {
            entities = await listEntities(t.name);
        } catch (err) {
            debug('temporal-archive', `Failed to list ${t.name}: ${err}`);
            result.errors++;
            continue;
        }

        for (const entity of entities) {
            if (!shouldArchiveNode(entity.meta as Record<string, unknown>, t.temporal, today)) {
                result.skipped++;
                continue;
            }

            const anchorDate = String(entity.meta[t.temporal.field] ?? '').split('T')[0];
            const title = String(entity.meta.title ?? entity.meta.id ?? 'unknown');

            try {
                await archiveEntity(entity.filepath, t.directory);
                result.archived++;
                result.details.push({ type: t.name, title, anchorDate });
            } catch (err) {
                debug('temporal-archive', `Failed to archive ${entity.filepath}: ${err}`);
                result.errors++;
            }
        }
    }

    return result;
}
