// ─────────────────────────────────────────────────────────────────────────────
// CF/x3 client transport — talks to a CF/x3 server (A2A JSON-RPC + Bearer key).
// Three calls map to the three CF/x3 skills: manifest, sync, act.
// ─────────────────────────────────────────────────────────────────────────────

import {
    CFX3_SKILLS, buildCfx3Request, extractDataArtifact,
    type A2ATask, type Cfx3Manifest, type Cfx3SyncResult, type Cfx3ActResult,
} from './protocol.js';
import type { Cfx3Source } from './source-registry.js';
import { debug } from '../utils/debug.js';

async function rpc(source: Cfx3Source, payload: Record<string, unknown>): Promise<A2ATask> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (source.apiKey) headers.Authorization = `Bearer ${source.apiKey}`;

    const res = await fetch(source.url, { method: 'POST', headers, body: JSON.stringify(payload) });
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`CF/x3 ${source.id} HTTP ${res.status}${txt ? `: ${txt.slice(0, 200)}` : ''}`);
    }
    const json = await res.json() as { result?: A2ATask; error?: { message: string } };
    if (json.error) throw new Error(`CF/x3 ${source.id} error: ${json.error.message}`);
    if (!json.result) throw new Error(`CF/x3 ${source.id}: response missing result`);
    if (json.result.status.state === 'failed') {
        throw new Error(`CF/x3 ${source.id}: ${json.result.status.message ?? 'task failed'}`);
    }
    return json.result;
}

export async function fetchManifest(source: Cfx3Source): Promise<Cfx3Manifest> {
    const task = await rpc(source, buildCfx3Request(CFX3_SKILLS.manifest));
    const data = extractDataArtifact<Cfx3Manifest>(task);
    if (!data) throw new Error(`CF/x3 ${source.id}: manifest returned no data`);
    debug('cfx3', `manifest ${source.id}: ${data.context_types.length} types, ${data.tools.length} tools`);
    return data;
}

export async function syncSource(source: Cfx3Source, since: string | null, types?: string[]): Promise<Cfx3SyncResult> {
    const task = await rpc(source, buildCfx3Request(CFX3_SKILLS.sync, { since: since ?? null, ...(types ? { types } : {}) }));
    const data = extractDataArtifact<Cfx3SyncResult>(task);
    if (!data) throw new Error(`CF/x3 ${source.id}: sync returned no data`);
    debug('cfx3', `sync ${source.id} since=${since ?? 'null'}: ${data.records.length} records, ${data.tombstones.length} tombstones`);
    return data;
}

export async function actOnSource(source: Cfx3Source, tool: string, args: Record<string, unknown>): Promise<Cfx3ActResult> {
    const task = await rpc(source, buildCfx3Request(CFX3_SKILLS.act, { tool, args }));
    const data = extractDataArtifact<Cfx3ActResult>(task);
    if (!data) throw new Error(`CF/x3 ${source.id}: act returned no data`);
    return data;
}
