// ─────────────────────────────────────────────────────────────────────────────
// A2A Client — Connection Manager
// ─────────────────────────────────────────────────────────────────────────────
// Singleton that manages A2A agent connections. Discovers agent skills via
// Agent Cards, sends tasks via JSON-RPC.
//
// A2A spec: https://google.github.io/A2A/
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { loadAgentsConfig } from './agent-config.js';
import { debug } from '../utils/debug.js';
// ── Client ───────────────────────────────────────────────────────────────────
class A2AClientManager {
    agents = new Map();
    cards = new Map();
    /**
     * Fetch Agent Cards from all configured A2A agents, discover their skills.
     */
    async discoverAllAgents() {
        const config = await loadAgentsConfig();
        if (config.agents.length === 0)
            return [];
        for (const agent of config.agents) {
            this.agents.set(agent.id, agent);
        }
        const results = await Promise.allSettled(config.agents.map(agent => this.fetchAgentCard(agent)));
        const discovered = [];
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result.status === 'fulfilled' && result.value) {
                const agent = config.agents[i];
                const card = result.value;
                this.cards.set(agent.id, card);
                discovered.push({
                    agentId: agent.id,
                    agentName: card.name,
                    description: card.description,
                    url: agent.url,
                    skills: card.skills ?? [],
                });
                debug('a2a-client', `Discovered agent "${card.name}" at ${agent.url} with ${card.skills?.length ?? 0} skills`);
            }
            else if (result.status === 'rejected') {
                console.warn(`[agents] Failed to connect to "${config.agents[i].name}": ${result.reason}`);
            }
        }
        return discovered;
    }
    /**
     * Send a task to an A2A agent. Returns the task result (synchronous — waits for completion).
     */
    async sendTask(agentId, message, options) {
        const agent = this.agents.get(agentId);
        if (!agent)
            throw new Error(`Unknown agent: ${agentId}`);
        const taskId = crypto.randomUUID();
        const parts = [];
        // Text message
        if (message) {
            parts.push({ type: 'text', text: message });
        }
        // Structured data (e.g. skill selection, query parameters)
        if (options?.data || options?.skillId) {
            parts.push({
                type: 'data',
                data: { skill: options.skillId, ...options?.data },
            });
        }
        const body = {
            jsonrpc: '2.0',
            id: taskId,
            method: 'tasks/send',
            params: {
                id: taskId,
                message: {
                    role: 'user',
                    parts,
                },
            },
        };
        const url = agent.url.replace(/\/$/, '') + '/a2a';
        const headers = {
            'Content-Type': 'application/json',
            ...agent.headers,
        };
        debug('a2a-client', `Sending task ${taskId} to ${agent.name} at ${url}`);
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw new Error(`A2A request failed: ${response.status} ${response.statusText}`);
        }
        const json = await response.json();
        if (json.error) {
            throw new Error(`A2A error: ${json.error.message}`);
        }
        if (!json.result) {
            throw new Error('A2A response missing result');
        }
        debug('a2a-client', `Task ${taskId} completed with state: ${json.result.status.state}`);
        return json.result;
    }
    /**
     * Get the status of a previously sent task.
     */
    async getTask(agentId, taskId) {
        const agent = this.agents.get(agentId);
        if (!agent)
            throw new Error(`Unknown agent: ${agentId}`);
        const url = agent.url.replace(/\/$/, '') + '/a2a';
        const headers = {
            'Content-Type': 'application/json',
            ...agent.headers,
        };
        const body = {
            jsonrpc: '2.0',
            id: 1,
            method: 'tasks/get',
            params: { id: taskId },
        };
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw new Error(`A2A request failed: ${response.status} ${response.statusText}`);
        }
        const json = await response.json();
        if (json.error) {
            throw new Error(`A2A error: ${json.error.message}`);
        }
        return json.result;
    }
    /**
     * Get the cached agent card for an agent.
     */
    getAgentCard(agentId) {
        return this.cards.get(agentId);
    }
    // ── Private ──────────────────────────────────────────────────────────────
    async fetchAgentCard(agent) {
        const url = agent.url.replace(/\/$/, '') + '/.well-known/agent.json';
        const headers = { ...agent.headers };
        const response = await fetch(url, { headers });
        if (!response.ok) {
            throw new Error(`Failed to fetch agent card: ${response.status} ${response.statusText}`);
        }
        return await response.json();
    }
}
export const a2aClient = new A2AClientManager();
