// ─────────────────────────────────────────────────────────────────────────────
// MCP Server — Expose Phaibel as an MCP tool server
//
// Agents can connect and use Phaibel's CxMS operations as MCP tools:
//   - chat: send a message through the full chat pipeline
//   - list_nodes: list context nodes by type
//   - get_node: get a single context node
//   - create_node: create a context node
//   - search: full-text search
//   - list_types: list context type schemas
// ─────────────────────────────────────────────────────────────────────────────

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type http from 'http';
import { listEntities, writeEntity, generateNodeId, ensureEntityDir, nodeFilename } from '../entities/entity.js';
import { loadEntityTypes } from '../entities/entity-type-config.js';
import { getEntityIndex } from '../entities/entity-index.js';
import { feralChatHeadless } from '../commands/chat.js';
import { debug } from '../utils/debug.js';

let _server: McpServer | null = null;
let _transport: StreamableHTTPServerTransport | null = null;

function getOrCreateServer(): McpServer {
    if (_server) return _server;

    _server = new McpServer(
        { name: 'phaibel', version: '1.0.0' },
        {
            capabilities: {
                tools: { listChanged: false },
                resources: {},
            },
        },
    );

    // ── Tools ──────────────────────────────────────────────────────────

    _server.tool(
        'chat',
        'Send a message to Phaibel and get a response. This goes through the full AI chat pipeline — process selection, execution, and synthesis.',
        { message: z.string().describe('The user message to process') },
        async ({ message }) => {
            try {
                const { response } = await feralChatHeadless(message);
                return { content: [{ type: 'text' as const, text: response }] };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
            }
        },
    );

    _server.tool(
        'list_nodes',
        'List context nodes of a given type from the Foundation. Returns titles, IDs, and key fields.',
        {
            type: z.string().describe('Context type (e.g. "task", "event", "note", "goal", "person")'),
            status: z.string().optional().describe('Filter by status (e.g. "active", "done")'),
            tag: z.string().optional().describe('Filter by tag'),
        },
        async ({ type, status, tag }) => {
            try {
                const filters: Record<string, string> = {};
                if (status) filters.status = status;
                if (tag) filters.tag = tag;
                const entities = await listEntities(type, filters);
                const summary = entities.map(e => ({
                    id: e.meta.id,
                    title: e.meta.title,
                    status: e.meta.status,
                    tags: e.meta.tags,
                }));
                return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
            }
        },
    );

    _server.tool(
        'get_node',
        'Get a single context node by type and ID. Returns full metadata and content.',
        {
            type: z.string().describe('Context type'),
            id: z.string().describe('Node ID'),
        },
        async ({ type, id }) => {
            try {
                const entities = await listEntities(type);
                const entity = entities.find(e => String(e.meta.id) === id || e.meta.title === id);
                if (!entity) {
                    return { content: [{ type: 'text' as const, text: `Context node not found: ${type}/${id}` }], isError: true };
                }
                return { content: [{ type: 'text' as const, text: JSON.stringify(entity, null, 2) }] };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
            }
        },
    );

    _server.tool(
        'create_node',
        'Create a new context node in the Foundation.',
        {
            type: z.string().describe('Context type (e.g. "task", "event", "note")'),
            title: z.string().describe('Node title'),
            content: z.string().optional().describe('Markdown body content'),
            fields: z.record(z.unknown()).optional().describe('Additional YAML frontmatter fields'),
        },
        async ({ type, title, content, fields }) => {
            try {
                const id = generateNodeId();
                const dir = await ensureEntityDir(type);
                const filename = nodeFilename(title, id);
                const filepath = `${dir}/${filename}`;
                const meta: Record<string, unknown> = { id, title, ...fields };
                await writeEntity(filepath, meta, content || '');
                return { content: [{ type: 'text' as const, text: JSON.stringify({ created: true, id, title }) }] };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
            }
        },
    );

    _server.tool(
        'search',
        'Full-text search across all context nodes in the Foundation.',
        {
            query: z.string().describe('Search query'),
            type: z.string().optional().describe('Filter to a specific context type'),
        },
        async ({ query, type }) => {
            try {
                const index = getEntityIndex();
                const results = index.search(query, type);
                const summary = results.slice(0, 20).map(r => ({
                    type: r.node.type,
                    id: r.node.id,
                    title: r.node.title,
                    score: r.score,
                }));
                return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
            }
        },
    );

    _server.tool(
        'list_types',
        'List all context types and their schemas.',
        {},
        async () => {
            try {
                const types = await loadEntityTypes();
                const summary = types.map(t => ({
                    name: t.name,
                    plural: t.plural,
                    fields: t.fields.map(f => f.key),
                }));
                return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
            }
        },
    );

    return _server;
}

/**
 * Handle an MCP request via Streamable HTTP.
 * Route: POST /mcp, GET /mcp, DELETE /mcp
 */
export async function handleMcpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<void> {
    const server = getOrCreateServer();

    if (!_transport) {
        _transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined, // stateless
        });
        await server.connect(_transport);
        debug('mcp-server', 'MCP server transport connected');
    }

    await _transport.handleRequest(req, res);
}
