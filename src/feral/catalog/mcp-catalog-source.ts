// ─────────────────────────────────────────────────────────────────────────────
// Feral MCP — Catalog Source
// ─────────────────────────────────────────────────────────────────────────────

import type { CatalogSource } from './catalog.js';
import type { CatalogNode } from './catalog-node.js';
import { createCatalogNode } from './catalog-node.js';
import type { McpToolInfo } from '../../skills/mcp-manager.js';

/**
 * Provides CatalogNodes for tools discovered from MCP skill servers.
 * Takes pre-discovered tool info (solves sync getCatalogNodes() constraint).
 */
export class McpCatalogSource implements CatalogSource {
    private tools: McpToolInfo[];

    constructor(tools: McpToolInfo[]) {
        this.tools = tools;
    }

    getCatalogNodes(): CatalogNode[] {
        return this.tools.map(tool => {
            // Build a description that includes parameter info so the LLM knows what args to provide
            let description = tool.description;
            const schema = tool.inputSchema as { properties?: Record<string, { description?: string; type?: string }>; required?: string[] };
            if (schema?.properties && Object.keys(schema.properties).length > 0) {
                const required = new Set(schema.required ?? []);
                const paramDescs = Object.entries(schema.properties).map(([key, prop]) => {
                    const req = required.has(key) ? '' : ', optional';
                    const type = prop.type ?? 'string';
                    return `${key} (${type}${req})${prop.description ? ': ' + prop.description : ''}`;
                });
                description += ` Parameters: ${paramDescs.join('; ')}.`;
            }

            return createCatalogNode({
                key: `mcp_${tool.skillId}_${tool.name}`,
                nodeCodeKey: 'mcp_call_tool',
                name: `${tool.skillId}: ${tool.name}`,
                group: `skill:${tool.skillId}`,
                description,
                configuration: {
                    skill_id: tool.skillId,
                    tool_name: tool.name,
                    // Store input schema so the node code can map extra config keys to tool args
                    _input_schema: JSON.stringify(schema?.properties ? Object.keys(schema.properties) : []),
                },
            });
        });
    }
}
