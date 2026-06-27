// ─────────────────────────────────────────────────────────────────────────────
// CF/x3 service — per-source orchestration the daemon REST + cron + Feral call.
// Ties the transport (cfx3-client), the registry (source-registry), and the
// CxMS ingest together, and owns the sync cursor.
// ─────────────────────────────────────────────────────────────────────────────

import { fetchManifest, syncSource, writeToSource } from './cfx3-client.js';
import { ensureTypesFromManifest, ingestRecords, type IngestResult } from './ingest.js';
import { getSource, patchSource, type Cfx3Source } from './source-registry.js';
import type { Cfx3Manifest, Cfx3WriteRequest, Cfx3WriteResult } from './protocol.js';
import { debug } from '../utils/debug.js';

const MANIFEST_TTL_MS = 24 * 60 * 60 * 1000; // refresh cached manifest at most daily

/** Fetch + cache the manifest, ensuring CxMS types exist. */
export async function refreshManifest(source: Cfx3Source): Promise<Cfx3Manifest> {
    const manifest = await fetchManifest(source);
    await ensureTypesFromManifest(manifest);
    await patchSource(source.id, { manifest, manifestRefreshedAt: new Date().toISOString() });
    return manifest;
}

async function ensureManifest(source: Cfx3Source): Promise<Cfx3Manifest> {
    const fresh = source.manifestRefreshedAt
        && Date.now() - Date.parse(source.manifestRefreshedAt) < MANIFEST_TTL_MS
        && source.manifest;
    return fresh ? source.manifest! : refreshManifest(source);
}

export interface SyncOutcome extends IngestResult { source: string; syncedAt: string; full: boolean; }

/**
 * Sync one source into CxMS. `full` (or no prior cursor) ⇒ full pull; otherwise
 * incremental from the stored `lastSyncAt`. Advances and persists the cursor.
 */
export async function syncSourceById(id: string, opts?: { full?: boolean }): Promise<SyncOutcome> {
    const source = await getSource(id);
    if (!source) throw new Error(`CF/x3 source not found: ${id}`);
    if (!source.enabled) throw new Error(`CF/x3 source disabled: ${id}`);

    await ensureManifest(source);
    const since = opts?.full ? null : (source.lastSyncAt ?? null);
    const res = await syncSource(source, since);
    const counts = await ingestRecords(source.id, res.records, res.tombstones);
    await patchSource(source.id, { lastSyncAt: res.syncedAt });

    debug('cfx3', `synced ${id}: full=${!since} cursor→${res.syncedAt}`);
    return { source: id, syncedAt: res.syncedAt, full: !since, ...counts };
}

/** Write context to a source (create/update/delete a node or type). */
export async function writeToSourceById(id: string, req: Cfx3WriteRequest): Promise<Cfx3WriteResult> {
    const source = await getSource(id);
    if (!source) throw new Error(`CF/x3 source not found: ${id}`);
    return writeToSource(source, req);
}

/** Refresh manifests + incremental-sync all enabled sources (used by cron). */
export async function syncAllEnabled(): Promise<SyncOutcome[]> {
    const { getEnabledSources } = await import('./source-registry.js');
    const sources = await getEnabledSources();
    const out: SyncOutcome[] = [];
    for (const s of sources) {
        try {
            out.push(await syncSourceById(s.id));
        } catch (err) {
            debug('cfx3', `sync ${s.id} failed: ${err instanceof Error ? err.message : err}`);
        }
    }
    return out;
}
