// ─────────────────────────────────────────────────────────────────────────────
// FCP Client — probe + fetch remote context sources.
//
// All requests are POST application/json. Auth is resolved per source from
// the secrets store (token_ref).
// ─────────────────────────────────────────────────────────────────────────────

import { loadSecrets } from '../config.js';
import { debug } from '../utils/debug.js';
import {
    FCP_VERSION,
    ProbeRequestSchema, ProbeResponseSchema,
    FetchRequestSchema, FetchResponseSchema,
    ManifestSchema,
    type ProbeRequest, type ProbeResponse,
    type FetchRequest, type FetchResponse,
    type Manifest, type SourceConfig, type Actor,
} from './fcp-types.js';

export class FcpError extends Error {
    constructor(message: string, public source: string, public status?: number) {
        super(message);
        this.name = 'FcpError';
    }
}

// ── Auth header resolution ──────────────────────────────────────────────────

async function authHeader(source: SourceConfig): Promise<Record<string, string>> {
    if (source.auth.type === 'none') return {};
    if (source.auth.type === 'bearer' && source.auth.token_ref) {
        const secrets = await loadSecrets();
        // token_ref is a dotted path into secrets.providers[x].apiKey
        // For v1 we treat it as the literal provider name
        const provider = secrets.providers[source.auth.token_ref];
        if (provider?.apiKey) return { Authorization: `Bearer ${provider.apiKey}` };
    }
    // 'signed' auth: future work — Ed25519 over canonical request body
    return {};
}

// ── HTTP helper with timeout ────────────────────────────────────────────────

async function post(url: string, body: unknown, headers: Record<string, string>, timeoutMs: number): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });
        if (!res.ok) {
            throw new FcpError(`${res.status} ${res.statusText}`, url, res.status);
        }
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

async function get(url: string, headers: Record<string, string>, timeoutMs: number): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, { method: 'GET', headers, signal: ctrl.signal });
        if (!res.ok) {
            throw new FcpError(`${res.status} ${res.statusText}`, url, res.status);
        }
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function probeSource(
    source: SourceConfig,
    actor: Actor,
    keywords: string[],
    opts: { timeoutMs?: number; entityTypes?: string[] } = {},
): Promise<ProbeResponse> {
    const timeoutMs = opts.timeoutMs ?? 600;
    const req: ProbeRequest = {
        fcp_version: FCP_VERSION,
        query: {
            keywords,
            hints: opts.entityTypes ? { entity_types: opts.entityTypes } : undefined,
        },
        actor,
        budget: { max_latency_ms: timeoutMs, max_matches_per_type: 5 },
    };
    ProbeRequestSchema.parse(req); // validate outbound

    const headers = await authHeader(source);
    const raw = await post(`${source.url}/probe`, req, headers, timeoutMs + 100);
    const parsed = ProbeResponseSchema.safeParse(raw);
    if (!parsed.success) {
        debug('fcp', `invalid probe response from ${source.id}: ${parsed.error.message}`);
        throw new FcpError(`invalid response shape from ${source.id}`, source.id);
    }
    return parsed.data;
}

export async function fetchFromSource(
    source: SourceConfig,
    actor: Actor,
    ids: string[],
    opts: { timeoutMs?: number; detail?: 'summary' | 'full'; purpose?: string } = {},
): Promise<FetchResponse> {
    const timeoutMs = opts.timeoutMs ?? 3000;
    const req: FetchRequest = {
        fcp_version: FCP_VERSION,
        ids,
        detail: opts.detail ?? 'full',
        actor,
        purpose: opts.purpose,
    };
    FetchRequestSchema.parse(req);

    const headers = await authHeader(source);
    const raw = await post(`${source.url}/fetch`, req, headers, timeoutMs + 100);
    const parsed = FetchResponseSchema.safeParse(raw);
    if (!parsed.success) {
        throw new FcpError(`invalid response shape from ${source.id}`, source.id);
    }
    return parsed.data;
}

export async function getManifest(source: SourceConfig, timeoutMs = 2000): Promise<Manifest> {
    const headers = await authHeader(source);
    const raw = await get(`${source.url}/manifest`, headers, timeoutMs);
    return ManifestSchema.parse(raw);
}
