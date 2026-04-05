// ─────────────────────────────────────────────────────────────────────────────
// A2A Client — Connection Manager
// ─────────────────────────────────────────────────────────────────────────────
// Singleton that manages A2A agent connections. Discovers agent skills via
// Agent Cards, sends tasks via JSON-RPC.
//
// A2A spec: https://google.github.io/A2A/
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'crypto';
import { loadAgentsConfig, type AgentEntry } from './agent-config.js';
import { debug } from '../utils/debug.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface A2AAgentCard {
    name: string;
    description: string;
    url: string;
    version?: string;
    capabilities?: Record<string, unknown>;
    skills?: A2ASkillInfo[];
}

export interface A2ASkillInfo {
    id: string;
    name: string;
    description: string;
    tags?: string[];
    examples?: string[];
}

export interface A2ADiscoveredAgent {
    agentId: string;       // config entry id
    agentName: string;     // from agent card
    description: string;   // from agent card
    url: string;
    skills: A2ASkillInfo[];
}

interface A2ATaskResult {
    id: string;
    status: { state: string };
    artifacts?: Array<{
        name?: string;
        parts: Array<{ type: string; text?: string; data?: unknown }>;
    }>;
    history?: Array<{
        role: string;
        parts: Array<{ type: string; text?: string; data?: unknown }>;
    }>;
}

// ── Client ───────────────────────────────────────────────────────────────────

class A2AClientManager {
    private agents = new Map<string, AgentEntry>();
    private cards = new Map<string, A2AAgentCard>();

    /**
     * Fetch Agent Cards from all configured A2A agents, discover their skills.
     */
    async discoverAllAgents(): Promise<A2ADiscoveredAgent[]> {
        const config = await loadAgentsConfig();
        if (config.agents.length === 0) return [];

        for (const agent of config.agents) {
            this.agents.set(agent.id, agent);
        }

        const results = await Promise.allSettled(
            config.agents.map(agent => this.fetchAgentCard(agent)),
        );

        const discovered: A2ADiscoveredAgent[] = [];
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
            } else if (result.status === 'rejected') {
                console.warn(`[agents] Failed to connect to "${config.agents[i].name}": ${result.reason}`);
            }
        }

        return discovered;
    }

    /**
     * Send a task to an A2A agent. Returns the task result (synchronous — waits for completion).
     */
    async sendTask(
        agentId: string,
        message: string,
        options?: { skillId?: string; data?: Record<string, unknown> },
    ): Promise<A2ATaskResult> {
        const agent = this.agents.get(agentId);
        if (!agent) throw new Error(`Unknown agent: ${agentId}`);

        const taskId = crypto.randomUUID();
        const parts: Array<{ type: string; text?: string; data?: unknown }> = [];

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
        const headers: Record<string, string> = {
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

        const json = await response.json() as { result?: A2ATaskResult; error?: { message: string } };

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
    async getTask(agentId: string, taskId: string): Promise<A2ATaskResult> {
        const agent = this.agents.get(agentId);
        if (!agent) throw new Error(`Unknown agent: ${agentId}`);

        const url = agent.url.replace(/\/$/, '') + '/a2a';
        const headers: Record<string, string> = {
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

        const json = await response.json() as { result?: A2ATaskResult; error?: { message: string } };

        if (json.error) {
            throw new Error(`A2A error: ${json.error.message}`);
        }

        return json.result!;
    }

    /**
     * Get the cached agent card for an agent.
     */
    getAgentCard(agentId: string): A2AAgentCard | undefined {
        return this.cards.get(agentId);
    }

    // ── Private ──────────────────────────────────────────────────────────────

    private async fetchAgentCard(agent: AgentEntry): Promise<A2AAgentCard> {
        const url = agent.url.replace(/\/$/, '') + '/.well-known/agent.json';
        const headers: Record<string, string> = { ...agent.headers };

        const response = await fetch(url, { headers });
        if (!response.ok) {
            throw new Error(`Failed to fetch agent card: ${response.status} ${response.statusText}`);
        }

        return await response.json() as A2AAgentCard;
    }
}

export const a2aClient = new A2AClientManager();
