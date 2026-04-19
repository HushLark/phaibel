// ─────────────────────────────────────────────────────────────────────────────
// MCP Skills — Connection Manager
// ─────────────────────────────────────────────────────────────────────────────
// Singleton that manages MCP server connections via stdio transport.
// ─────────────────────────────────────────────────────────────────────────────

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadSkillsConfig, type SkillEntry } from './skill-config.js';

export interface McpToolInfo {
    skillId: string;
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

interface McpConnection {
    client: Client;
    transport: StdioClientTransport;
}

class McpManager {
    private connections = new Map<string, McpConnection>();
    private skills = new Map<string, SkillEntry>();
    private cleanupRegistered = false;

    /**
     * Connect to all configured MCP servers, discover their tools,
     * and return a flat list of tool info.
     */
    async discoverAllTools(): Promise<McpToolInfo[]> {
        const config = await loadSkillsConfig();
        if (config.skills.length === 0) return [];

        for (const skill of config.skills) {
            this.skills.set(skill.id, skill);
        }

        this.registerCleanup();

        const results = await Promise.allSettled(
            config.skills.map(skill => this.discoverToolsForSkill(skill)),
        );

        const tools: McpToolInfo[] = [];
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result.status === 'fulfilled') {
                tools.push(...result.value);
            } else {
                console.warn(`[skills] Failed to connect to "${config.skills[i].name}": ${result.reason}`);
            }
        }

        return tools;
    }

    /**
     * Call a tool on a specific skill's MCP server.
     */
    async callTool(skillId: string, toolName: string, args: Record<string, unknown> = {}): Promise<unknown> {
        let conn = this.connections.get(skillId);
        if (!conn) {
            const skill = this.skills.get(skillId);
            if (!skill) throw new Error(`Unknown skill: ${skillId}`);
            conn = await this.connect(skill);
        }

        const result = await conn.client.callTool({ name: toolName, arguments: args });
        return result;
    }

    /**
     * Close all MCP connections.
     */
    async closeAll(): Promise<void> {
        for (const [id, conn] of this.connections) {
            try {
                await conn.transport.close();
            } catch {
                // Ignore close errors during cleanup
            }
            this.connections.delete(id);
        }
    }

    private async discoverToolsForSkill(skill: SkillEntry): Promise<McpToolInfo[]> {
        const conn = await this.connect(skill);
        const response = await conn.client.listTools();

        return response.tools.map(tool => ({
            skillId: skill.id,
            name: tool.name,
            description: tool.description ?? '',
            inputSchema: (tool.inputSchema ?? {}) as Record<string, unknown>,
        }));
    }

    private async connect(skill: SkillEntry): Promise<McpConnection> {
        const existing = this.connections.get(skill.id);
        if (existing) return existing;

        const transport = new StdioClientTransport({
            command: skill.command,
            args: skill.args,
            env: { ...process.env, ...skill.env } as Record<string, string>,
        });

        const client = new Client(
            { name: 'phaibel', version: '1.0.0' },
            { capabilities: {} },
        );

        await client.connect(transport);

        const conn: McpConnection = { client, transport };
        this.connections.set(skill.id, conn);
        return conn;
    }

    private registerCleanup(): void {
        if (this.cleanupRegistered) return;
        this.cleanupRegistered = true;

        const cleanup = () => {
            this.closeAll().catch(() => {});
        };

        process.on('exit', cleanup);
        process.on('SIGINT', () => { cleanup(); process.exit(0); });
        process.on('SIGTERM', () => { cleanup(); process.exit(0); });
    }
}

export const mcpManager = new McpManager();
