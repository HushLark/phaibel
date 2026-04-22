// ─────────────────────────────────────────────────────────────────────────────
// A2A Server — Agent-to-Agent Protocol for Phaibel
//
// Implements the Google A2A protocol so other agents can interact with Phaibel:
//   GET  /.well-known/agent.json  → Agent Card (discovery)
//   POST /a2a                     → tasks/send (send a task)
//   GET  /a2a                     → tasks/get (get task status)
//
// A2A spec: https://google.github.io/A2A/
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { feralChatHeadless } from '../commands/chat.js';
import { listEntities } from '../entities/entity.js';
import { getEntityIndex } from '../entities/entity-index.js';
import { loadContextTypes } from '../entities/entity-type-config.js';
import { debug } from '../utils/debug.js';
// ── In-memory task store (simple, no persistence needed) ────────────────────
const tasks = new Map();
const MAX_TASKS = 100;
function pruneOldTasks() {
    if (tasks.size <= MAX_TASKS)
        return;
    const keys = Array.from(tasks.keys());
    for (let i = 0; i < keys.length - MAX_TASKS; i++) {
        tasks.delete(keys[i]);
    }
}
// ── Agent Card ──────────────────────────────────────────────────────────────
const AGENT_CARD = {
    name: 'Phaibel',
    description: 'Personal Digital Agent — manages context nodes (tasks, events, notes, goals, people) in a Foundation with AI-powered workflows.',
    url: '', // filled dynamically
    version: '1.0.0',
    capabilities: {
        streaming: false,
        pushNotifications: false,
        stateTransitionHistory: false,
    },
    authentication: {
        schemes: [],
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [
        {
            id: 'chat',
            name: 'Chat',
            description: 'Send a message through the full Phaibel AI pipeline — understands natural language, creates/updates context nodes, runs workflows.',
            tags: ['chat', 'ai', 'agent'],
            examples: [
                'Create a task to buy groceries',
                'What events do I have this week?',
                'Link the meeting with the project goal',
            ],
        },
        {
            id: 'query',
            name: 'Query Foundation',
            description: 'Search and list context nodes in the Foundation. Supports filtering by type, status, and full-text search.',
            tags: ['search', 'context', 'data'],
            examples: [
                'List all active tasks',
                'Search for anything about the project',
            ],
        },
    ],
};
// ── Skill handlers ──────────────────────────────────────────────────────────
async function handleChatSkill(text) {
    const { response } = await feralChatHeadless(text);
    return [{
            name: 'response',
            parts: [{ type: 'text', text: response }],
        }];
}
async function handleQuerySkill(data) {
    const action = data.action || 'search';
    if (action === 'list') {
        const type = data.type || 'todo';
        const filters = {};
        if (data.status)
            filters.status = data.status;
        if (data.tag)
            filters.tag = data.tag;
        const entities = await listEntities(type, filters);
        const summary = entities.map(e => ({
            id: e.meta.id,
            title: e.meta.title,
            status: e.meta.status,
        }));
        return [{
                name: 'entities',
                parts: [{ type: 'data', data: { type, count: summary.length, entities: summary } }],
            }];
    }
    if (action === 'search') {
        const query = data.query || '';
        const index = getEntityIndex();
        const results = index.search(query, data.type);
        const summary = results.slice(0, 20).map(r => ({
            type: r.node.type, id: r.node.id, title: r.node.title, score: r.score,
        }));
        return [{
                name: 'search_results',
                parts: [{ type: 'data', data: { query, count: summary.length, results: summary } }],
            }];
    }
    if (action === 'types') {
        const types = await loadContextTypes();
        const summary = types.map(t => ({
            name: t.name,
            plural: t.plural,
            fields: t.fields.map(f => f.key),
        }));
        return [{
                name: 'entity_types',
                parts: [{ type: 'data', data: { count: summary.length, types: summary } }],
            }];
    }
    throw new Error(`Unknown query action: ${action}`);
}
// ── Request handling ────────────────────────────────────────────────────────
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString()));
        req.on('error', reject);
    });
}
function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}
function jsonrpcResponse(id, result) {
    return { jsonrpc: '2.0', id, result };
}
function jsonrpcError(id, code, message) {
    return { jsonrpc: '2.0', id, error: { code, message } };
}
/**
 * Handle the Agent Card request.
 * GET /.well-known/agent.json
 */
export function handleAgentCard(req, res) {
    const host = req.headers.host || 'localhost:3737';
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const card = { ...AGENT_CARD, url: `${proto}://${host}` };
    json(res, 200, card);
}
/**
 * Handle A2A JSON-RPC requests.
 * POST /a2a
 */
export async function handleA2ARequest(req, res) {
    let body;
    try {
        const raw = await readBody(req);
        body = JSON.parse(raw);
    }
    catch {
        json(res, 400, jsonrpcError(null, -32700, 'Parse error'));
        return;
    }
    const method = body.method;
    const params = (body.params || {});
    const id = body.id;
    if (!method) {
        json(res, 400, jsonrpcError(id, -32600, 'Invalid request: missing method'));
        return;
    }
    try {
        switch (method) {
            case 'tasks/send': {
                const taskId = params.id || crypto.randomUUID();
                const message = params.message;
                if (!message || !message.parts || message.parts.length === 0) {
                    json(res, 400, jsonrpcError(id, -32602, 'Invalid params: message with parts required'));
                    return;
                }
                // Create task in submitted state
                const task = {
                    id: taskId,
                    status: { state: 'working' },
                    history: [message],
                };
                tasks.set(taskId, task);
                pruneOldTasks();
                // Extract text and data from parts
                const textParts = message.parts.filter((p) => p.type === 'text');
                const dataParts = message.parts.filter((p) => p.type === 'data');
                const text = textParts.map(p => p.text).join('\n');
                // Determine skill from data parts or default to chat
                const skillData = dataParts.find(p => p.data.skill)?.data;
                const skill = skillData?.skill || 'chat';
                try {
                    let artifacts;
                    if (skill === 'query' && skillData) {
                        artifacts = await handleQuerySkill(skillData);
                    }
                    else {
                        artifacts = await handleChatSkill(text || JSON.stringify(skillData || {}));
                    }
                    task.status = { state: 'completed' };
                    task.artifacts = artifacts;
                    task.history.push({
                        role: 'agent',
                        parts: artifacts.flatMap(a => a.parts),
                    });
                    debug('a2a', `Task ${taskId} completed (skill: ${skill})`);
                }
                catch (err) {
                    task.status = { state: 'failed' };
                    task.history.push({
                        role: 'agent',
                        parts: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
                    });
                    debug('a2a', `Task ${taskId} failed: ${err}`);
                }
                json(res, 200, jsonrpcResponse(id, task));
                return;
            }
            case 'tasks/get': {
                const taskId = params.id;
                if (!taskId) {
                    json(res, 400, jsonrpcError(id, -32602, 'Invalid params: id required'));
                    return;
                }
                const task = tasks.get(taskId);
                if (!task) {
                    json(res, 404, jsonrpcError(id, -32001, `Task not found: ${taskId}`));
                    return;
                }
                json(res, 200, jsonrpcResponse(id, task));
                return;
            }
            case 'tasks/cancel': {
                const taskId = params.id;
                const task = tasks.get(taskId);
                if (task && task.status.state === 'working') {
                    task.status = { state: 'canceled' };
                }
                json(res, 200, jsonrpcResponse(id, task || null));
                return;
            }
            default:
                json(res, 400, jsonrpcError(id, -32601, `Method not found: ${method}`));
        }
    }
    catch (err) {
        debug('a2a', `Error handling ${method}: ${err}`);
        json(res, 500, jsonrpcError(id, -32603, err instanceof Error ? err.message : 'Internal error'));
    }
}
