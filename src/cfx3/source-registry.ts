// ─────────────────────────────────────────────────────────────────────────────
// CF/x3 source registry — the external CF/x3 servers this Phaibel pulls from.
//
// Stored in ~/.phaibel/cfx3-sources.json (daemon-owned, NOT in the vault), since
// it holds API keys. Each source carries its endpoint, key, enabled flag, the
// client-owned sync cursor (`lastSyncAt`), and a cached manifest.
// ─────────────────────────────────────────────────────────────────────────────

import { getPlatform } from '../platform/index.js';
import { SYSTEM_DIR, CFX3_SOURCES_PATH } from '../paths.js';
import { debug } from '../utils/debug.js';
import type { Cfx3Manifest } from './protocol.js';

export interface Cfx3Source {
    id: string;                 // stable slug, e.g. 'synaptic'
    name: string;
    url: string;                // CF/x3 base endpoint, e.g. https://synaptic.hushlark.ai/v1/cfx3
    apiKey: string;             // Bearer credential
    enabled: boolean;
    lastSyncAt?: string;        // ISO — the `since` cursor for the next sync (client-owned)
    manifestRefreshedAt?: string;
    manifest?: Cfx3Manifest;    // cached manifest
}

interface SourcesFile { sources: Cfx3Source[]; }

export function slugForName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'source';
}

/** A resolved CF/x3 connection reference — its stable id + the user-facing name. */
export interface Cfx3Scope { id: string; name: string; }

function containsPhrase(haystackLower: string, needleLower: string): boolean {
    const escaped = needleLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystackLower);
}

/**
 * Make a CF/x3 connection a first-class, *named* concept: if the user's text
 * mentions a connection by name ("in Acme CRM, what's the latest"), resolve it to
 * that connection so context search can be scoped to it and answers attributed to
 * it. Returns the most specific (longest-named) match, or undefined.
 */
export async function resolveScopeFromInput(text: string): Promise<Cfx3Scope | undefined> {
    if (!text) return undefined;
    const sources = await loadSources();
    const lower = text.toLowerCase();
    const match = sources
        .filter(s => s.enabled && s.name && s.name.trim().length >= 2)
        .filter(s => containsPhrase(lower, s.name.toLowerCase()))
        .sort((a, b) => b.name.length - a.name.length)[0];
    return match ? { id: match.id, name: match.name } : undefined;
}

/** Map of source id → display name, for attributing federated context to its origin. */
export async function getSourceNames(): Promise<Map<string, string>> {
    return new Map((await loadSources()).map(s => [s.id, s.name]));
}

export async function loadSources(): Promise<Cfx3Source[]> {
    try {
        const raw = await getPlatform().storage.readFile(CFX3_SOURCES_PATH());
        const parsed = JSON.parse(raw) as SourcesFile;
        return Array.isArray(parsed.sources) ? parsed.sources : [];
    } catch {
        return [];
    }
}

export async function saveSources(sources: Cfx3Source[]): Promise<void> {
    const { storage } = getPlatform();
    await storage.mkdir(SYSTEM_DIR(), { recursive: true });
    await storage.writeFile(CFX3_SOURCES_PATH(), JSON.stringify({ sources }, null, 2));
}

export async function getSource(id: string): Promise<Cfx3Source | undefined> {
    return (await loadSources()).find(s => s.id === id);
}

export async function getEnabledSources(): Promise<Cfx3Source[]> {
    return (await loadSources()).filter(s => s.enabled);
}

/** Add a source (or update by id if it already exists). Returns the stored row. */
export async function upsertSource(input: {
    id?: string; name: string; url: string; apiKey?: string; enabled?: boolean;
}): Promise<Cfx3Source> {
    const sources = await loadSources();
    const id = input.id?.trim() || slugForName(input.name);
    const existing = sources.find(s => s.id === id);
    const row: Cfx3Source = {
        id,
        name: input.name,
        url: input.url.replace(/\/$/, ''),
        apiKey: input.apiKey ?? existing?.apiKey ?? '',
        enabled: input.enabled ?? existing?.enabled ?? true,
        lastSyncAt: existing?.lastSyncAt,
        manifestRefreshedAt: existing?.manifestRefreshedAt,
        manifest: existing?.manifest,
    };
    const next = existing ? sources.map(s => (s.id === id ? row : s)) : [...sources, row];
    await saveSources(next);
    debug('cfx3', `source upserted: ${id} (${row.url})`);
    return row;
}

export async function removeSource(id: string): Promise<boolean> {
    const sources = await loadSources();
    const next = sources.filter(s => s.id !== id);
    if (next.length === sources.length) return false;
    await saveSources(next);
    return true;
}

/** Patch a single source in place (cursor, cached manifest, enabled, …). */
export async function patchSource(id: string, patch: Partial<Cfx3Source>): Promise<void> {
    const sources = await loadSources();
    const next = sources.map(s => (s.id === id ? { ...s, ...patch } : s));
    await saveSources(next);
}

/** Public-safe view (no apiKey) for surfacing to the Mylson UI. */
export function redactSource(s: Cfx3Source) {
    return {
        id: s.id, name: s.name, url: s.url, enabled: s.enabled,
        hasKey: !!s.apiKey, lastSyncAt: s.lastSyncAt ?? null,
        manifestRefreshedAt: s.manifestRefreshedAt ?? null,
        contextTypes: s.manifest?.context_types.map(t => t.name) ?? [],
        capabilities: s.manifest?.capabilities ?? null,
    };
}
