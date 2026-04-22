import { findEntityByTitle, listEntities, } from '../entities/entity.js';
import { registerServiceTool } from './types.js';
// ─────────────────────────────────────────────────────────────────────────────
// RESEARCH.REVIEW — AI review (needs LLM)
// ─────────────────────────────────────────────────────────────────────────────
registerServiceTool({
    name: 'research.review',
    description: 'Review research with AI for insights and next steps',
    type: 'ai',
    capability: 'reason',
    inputSchema: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'Research title to review', required: true },
        },
        required: ['title'],
    },
    execute: async (input, context) => {
        const { title } = input;
        context.log.info(`Reviewing research: ${title}`);
        const found = await findEntityByTitle('research', title);
        if (!found) {
            return { success: false, output: null, error: `Research "${title}" not found` };
        }
        const sources = found.meta.sources || [];
        const sourceSection = sources.length > 0
            ? `\nSources:\n${sources.map(s => `  - ${s}`).join('\n')}`
            : '';
        const response = await context.llm.chat([
            { role: 'user', content: `Review this research and suggest next steps or insights:\n\nTitle: ${found.meta.title}\nStatus: ${found.meta.status}${sourceSection}\n\n${found.content}` },
        ]);
        return { success: true, output: response };
    },
});
// ─────────────────────────────────────────────────────────────────────────────
// RESEARCH.LIST — Custom logic, stays as service tool
// ─────────────────────────────────────────────────────────────────────────────
registerServiceTool({
    name: 'research.list',
    description: 'List all research documents',
    type: 'deterministic',
    inputSchema: {
        type: 'object',
        properties: {
            status: { type: 'string', description: 'Filter by status' },
        },
    },
    execute: async (input, context) => {
        const { status } = input || {};
        context.log.info('Listing research');
        const entities = await listEntities('research');
        const items = entities
            .filter(e => !status || e.meta.status === status)
            .map(e => ({
            title: e.meta.title,
            filepath: e.filepath,
            status: e.meta.status,
            sources: e.meta.sources || [],
            tags: e.meta.tags || [],
        }));
        return { success: true, output: { research: items } };
    },
});
