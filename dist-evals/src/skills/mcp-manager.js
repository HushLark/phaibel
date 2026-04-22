// ─────────────────────────────────────────────────────────────────────────────
// MCP Skills — Connection Manager
// ─────────────────────────────────────────────────────────────────────────────
// Singleton that manages MCP server connections via stdio transport.
// ─────────────────────────────────────────────────────────────────────────────
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadSkillsConfig } from './skill-config.js';
class McpManager {
    connections = new Map();
    skills = new Map();
    cleanupRegistered = false;
    /**
     * Connect to all configured MCP servers, discover their tools,
     * and return a flat list of tool info.
     */
    async discoverAllTools() {
        const config = await loadSkillsConfig();
        if (config.skills.length === 0)
            return [];
        for (const skill of config.skills) {
            this.skills.set(skill.id, skill);
        }
        this.registerCleanup();
        const results = await Promise.allSettled(config.skills.map(skill => this.discoverToolsForSkill(skill)));
        const tools = [];
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result.status === 'fulfilled') {
                tools.push(...result.value);
            }
            else {
                console.warn(`[skills] Failed to connect to "${config.skills[i].name}": ${result.reason}`);
            }
        }
        return tools;
    }
    /**
     * Call a tool on a specific skill's MCP server.
     */
    async callTool(skillId, toolName, args = {}) {
        let conn = this.connections.get(skillId);
        if (!conn) {
            const skill = this.skills.get(skillId);
            if (!skill)
                throw new Error(`Unknown skill: ${skillId}`);
            conn = await this.connect(skill);
        }
        const result = await conn.client.callTool({ name: toolName, arguments: args });
        return result;
    }
    /**
     * Close all MCP connections.
     */
    async closeAll() {
        for (const [id, conn] of this.connections) {
            try {
                await conn.transport.close();
            }
            catch {
                // Ignore close errors during cleanup
            }
            this.connections.delete(id);
        }
    }
    async discoverToolsForSkill(skill) {
        const conn = await this.connect(skill);
        const response = await conn.client.listTools();
        return response.tools.map(tool => ({
            skillId: skill.id,
            name: tool.name,
            description: tool.description ?? '',
            inputSchema: (tool.inputSchema ?? {}),
        }));
    }
    async connect(skill) {
        const existing = this.connections.get(skill.id);
        if (existing)
            return existing;
        const transport = new StdioClientTransport({
            command: skill.command,
            args: skill.args,
            env: { ...process.env, ...skill.env },
        });
        const client = new Client({ name: 'phaibel', version: '1.0.0' }, { capabilities: {} });
        await client.connect(transport);
        const conn = { client, transport };
        this.connections.set(skill.id, conn);
        return conn;
    }
    registerCleanup() {
        if (this.cleanupRegistered)
            return;
        this.cleanupRegistered = true;
        const cleanup = () => {
            this.closeAll().catch(() => { });
        };
        process.on('exit', cleanup);
        process.on('SIGINT', () => { cleanup(); process.exit(0); });
        process.on('SIGTERM', () => { cleanup(); process.exit(0); });
    }
}
export const mcpManager = new McpManager();
