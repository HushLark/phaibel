import {
    findEntityByTitle,
    listEntities,
} from '../entities/entity.js';
import { registerServiceTool, type ServiceToolResult } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// NOTES.REVIEW — AI review (needs LLM proxy, stays as service tool)
// ─────────────────────────────────────────────────────────────────────────────

registerServiceTool({
    name: 'notes.review',
    description: 'Review a note with AI for suggestions',
    type: 'ai',
    capability: 'reason',
    inputSchema: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'Note title to review', required: true },
        },
        required: ['title'],
    },
    execute: async (input, context): Promise<ServiceToolResult> => {
        const { title } = input as { title: string };

        context.log.info(`Reviewing note: ${title}`);

        const found = await findEntityByTitle('note', title);
        if (!found) {
            return { success: false, output: null, error: `Note "${title}" not found` };
        }

        const response = await context.llm.chat([
            { role: 'user', content: `Review this note and suggest improvements:\n\nTitle: ${found.meta.title}\n\n${found.content}` },
        ]);

        return { success: true, output: response };
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// NOTES.LIST — Custom logic, stays as service tool
// ─────────────────────────────────────────────────────────────────────────────

registerServiceTool({
    name: 'notes.list',
    description: 'List all notes in the current project',
    type: 'deterministic',
    execute: async (_input, context): Promise<ServiceToolResult> => {
        context.log.info('Listing notes');

        const entities = await listEntities('note');
        const notes = entities.map(e => ({
            title: e.meta.title as string,
            filepath: e.filepath,
            created: e.meta.created as string,
        }));

        return { success: true, output: { notes } };
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// NOTES.GET — Custom logic (reads full content), stays as service tool
// ─────────────────────────────────────────────────────────────────────────────

registerServiceTool({
    name: 'notes.get',
    description: 'Get a specific note by title',
    type: 'deterministic',
    inputSchema: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'Note title', required: true },
        },
        required: ['title'],
    },
    execute: async (input, context): Promise<ServiceToolResult> => {
        const { title } = input as { title: string };

        context.log.info(`Getting note: ${title}`);

        const found = await findEntityByTitle('note', title);
        if (!found) {
            return { success: false, output: null, error: `Note "${title}" not found` };
        }

        return {
            success: true,
            output: {
                title: found.meta.title,
                content: found.content,
                created: found.meta.created,
            },
            canvasUpdate: {
                type: 'note',
                title: found.meta.title as string,
                content: found.content,
                dirty: false,
            },
        };
    },
});
