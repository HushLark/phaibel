import { registerServiceTool } from './types.js';
// ─────────────────────────────────────────────────────────────────────────────
// SUMMARIZE TOOL (V2)
// ─────────────────────────────────────────────────────────────────────────────
registerServiceTool({
    name: 'summarize',
    description: 'Summarizes text using AI',
    type: 'ai',
    capability: 'summarize',
    inputSchema: {
        type: 'object',
        properties: {
            text: { type: 'string', description: 'Text to summarize', required: true },
        },
        required: ['text'],
    },
    execute: async (input, context) => {
        const { text } = input;
        context.log.info('Summarizing text');
        const fullContext = await context.ctx.getFullContext('notes');
        const response = await context.llm.chat([
            { role: 'system', content: fullContext.combined },
            { role: 'user', content: `Please summarize the following text concisely:\n\n${text}` },
        ]);
        return {
            success: true,
            output: response,
        };
    },
});
