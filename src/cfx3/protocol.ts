// ─────────────────────────────────────────────────────────────────────────────
// CF/x3 — Context Federation protocol (a profile of A2A)
//
// CF/x3 deals ONLY with context: it federates context types and context nodes,
// and supports CRUD on them. Domain actions/tools (e.g. "win a deal") are NOT
// part of CF/x3 — those are exposed separately (e.g. an MCP server).
//
// Transport is A2A unchanged: discovery via an agent card, invocation via a
// JSON-RPC `tasks/send` whose message carries a `data` part `{ skill, ... }`;
// results return as task `artifacts` carrying a `data` part. Auth is a Bearer
// API key on the POST. CF/x3 has three well-known skills + a JSON record format:
//   cfx3.manifest → context types the source exposes + write capabilities
//   cfx3.sync     → READ: bulk transfer; full (since=null) or incremental (since=ISO)
//   cfx3.write    → CREATE / UPDATE / DELETE of context nodes (and context types)
//
// This module is the shared contract for the Phaibel CF/x3 CLIENT. A CF/x3 SERVER
// (e.g. synaptic-stack, a separate repo) re-declares the matching wire types.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'crypto';

export const CFX3_VERSION = 1;

/** Skill ids carried in the A2A data part `{ skill }`. */
export const CFX3_SKILLS = {
    manifest: 'cfx3.manifest',
    sync: 'cfx3.sync',
    write: 'cfx3.write',
} as const;
export type Cfx3Skill = (typeof CFX3_SKILLS)[keyof typeof CFX3_SKILLS];

// ── Manifest ─────────────────────────────────────────────────────────────────

export interface Cfx3FieldDef {
    key: string;
    type: string;          // string | number | date | datetime | enum | reference | ...
    label?: string;
    required?: boolean;
    values?: string[];     // enum values
    targetType?: string;   // for reference fields
}

export interface Cfx3TypeDef {
    name: string;          // context type, e.g. 'company'
    plural?: string;
    description?: string;
    baseCategory?: string; // person | place | thing | event | task | goal
    fields?: Cfx3FieldDef[];
    readonly?: boolean;     // node create/update/delete not allowed for this type
}

/** Which write operations the source permits the caller (role-filtered). */
export interface Cfx3Capabilities {
    writeNodes: boolean;   // node.create / node.update
    deleteNodes: boolean;  // node.delete
    manageTypes: boolean;  // type.create / type.update / type.delete
}

export interface Cfx3Manifest {
    cfx3_version: number;
    source: string;        // stable source id, e.g. 'synaptic'
    name: string;          // display name
    context_types: Cfx3TypeDef[];
    capabilities: Cfx3Capabilities;
    auth: { schemes: 'bearer'[] };
}

// ── Context records ──────────────────────────────────────────────────────────

export interface Cfx3Link {
    label: string;
    target: string;        // another node's uid
}

export interface Cfx3Node {
    uid: string;           // stable remote id, e.g. 'crm/company/CO123'
    type: string;          // a context_type name from the manifest
    title: string;
    summary?: string;
    body?: string;
    fields?: Record<string, unknown>;
    links?: Cfx3Link[];
    updated: string;       // ISO 8601
    deleted?: boolean;
}

export interface Cfx3SyncRequest {
    since?: string | null; // null/absent ⇒ full sync; ISO ⇒ records changed since
    types?: string[];
    limit?: number;
    cursor?: string;       // server-issued paging cursor within one sync
}

export interface Cfx3SyncResult {
    records: Cfx3Node[];
    tombstones: string[];  // uids deleted since `since`
    syncedAt: string;      // ISO — client stores this as its next `since`
    nextCursor?: string;   // present when more pages remain
}

// ── Context CRUD (cfx3.write) ────────────────────────────────────────────────
// CF/x3's only mutation surface: create/update/delete context nodes, and (where
// the source allows) create/update/delete context types. Nothing else.

export type Cfx3WriteOp =
    | 'node.create' | 'node.update' | 'node.delete'
    | 'type.create' | 'type.update' | 'type.delete';

export interface Cfx3WriteRequest {
    op: Cfx3WriteOp;
    // node.create / node.update: the node to write (uid required for update).
    node?: {
        type?: string; uid?: string; title?: string;
        fields?: Record<string, unknown>; body?: string; links?: Cfx3Link[];
    };
    uid?: string;          // node.delete
    type?: Cfx3TypeDef;    // type.create / type.update
    typeName?: string;     // type.delete
}

export interface Cfx3WriteResult {
    ok: boolean;
    uid?: string;          // uid of the created/updated node
    message?: string;
}

// ── A2A envelope (the transport CF/x3 rides on) ──────────────────────────────

export type A2APart =
    | { type: 'text'; text: string }
    | { type: 'data'; data: Record<string, unknown> };

export interface A2AMessage {
    role: 'user' | 'agent';
    parts: A2APart[];
}

export interface A2AArtifact {
    name?: string;
    parts: A2APart[];
}

export interface A2ATaskState {
    state: 'submitted' | 'working' | 'completed' | 'failed' | 'canceled';
    message?: string;
}

export interface A2ATask {
    id: string;
    status: A2ATaskState;
    artifacts?: A2AArtifact[];
    history?: A2AMessage[];
}

// ── Helpers (used by both client and a re-declared server) ────────────────────

/** Build a JSON-RPC `tasks/send` body invoking a CF/x3 skill with a payload. */
export function buildCfx3Request(skill: Cfx3Skill, payload: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        jsonrpc: '2.0',
        id: randomUUID(),
        method: 'tasks/send',
        params: {
            message: { role: 'user', parts: [{ type: 'data', data: { skill, ...payload } }] },
        },
    };
}

/** Pull the first `data` artifact payload out of a completed A2A task. */
export function extractDataArtifact<T = Record<string, unknown>>(task: A2ATask): T | null {
    for (const artifact of task.artifacts ?? []) {
        for (const part of artifact.parts) {
            if (part.type === 'data') return part.data as T;
        }
    }
    return null;
}

/** A CF/x3 agent card (A2A discovery doc) for a source exposing the 3 skills. */
export function cfx3AgentCard(source: string, name: string, url: string) {
    return {
        name,
        description: `CF/x3 federated context + action source (${source}).`,
        url,
        version: '1.0.0',
        capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
        authentication: { schemes: ['bearer'] },
        defaultInputModes: ['data'],
        defaultOutputModes: ['data'],
        skills: [
            { id: CFX3_SKILLS.manifest, name: 'Manifest', description: 'Context types this source exposes + write capabilities.', tags: ['cfx3', 'manifest'] },
            { id: CFX3_SKILLS.sync, name: 'Sync', description: 'Read federated context (full or incremental via `since`).', tags: ['cfx3', 'context'] },
            { id: CFX3_SKILLS.write, name: 'Write', description: 'Create / update / delete context nodes and types.', tags: ['cfx3', 'context'] },
        ],
    };
}
