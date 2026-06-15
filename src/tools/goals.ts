import {
    type GoalPriority,
    type GoalStatus,
    type SmartFields,
    findEntityByTitle,
    listEntities,
} from '../entities/entity.js';
import { registerServiceTool, type ServiceToolResult } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// GOALS.REVIEW — AI review with SMART analysis (needs LLM)
// ─────────────────────────────────────────────────────────────────────────────

registerServiceTool({
    name: 'goals.review',
    description: 'Review goals with AI for SMART analysis',
    type: 'ai',
    capability: 'reason',
    inputSchema: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'Review a specific goal by title' },
        },
    },
    execute: async (input, context): Promise<ServiceToolResult> => {
        const { title } = input as { title?: string };

        context.log.info('Reviewing goals with AI');

        if (title) {
            const found = await findEntityByTitle('goal', title);
            if (!found) {
                return { success: false, output: null, error: `Goal "${title}" not found` };
            }

            const smart = found.meta.smart as Partial<SmartFields> | undefined;
            const smartSection = smart
                ? `\nSMART Analysis:\n  Specific: ${smart.specific || 'Not defined'}\n  Measurable: ${smart.measurable || 'Not defined'}\n  Achievable: ${smart.achievable || 'Not defined'}\n  Relevant: ${smart.relevant || 'Not defined'}\n  Time-bound: ${smart.timeBound || 'Not defined'}`
                : '\nNo SMART fields defined.';

            const response = await context.llm.chat([
                { role: 'user', content: `Review this goal and provide SMART analysis feedback:\n\nTitle: ${found.meta.title}\nStatus: ${found.meta.status}\nPriority: ${found.meta.priority}\n${smartSection}\n\n${found.content}` },
            ]);

            return { success: true, output: response };
        }

        // Review all active goals
        const entities = await listEntities('goal');
        const goals = entities
            .filter(e => e.meta.status === 'active')
            .map(e => `- ${e.meta.title} [${e.meta.priority}]`)
            .join('\n');

        if (!goals) {
            return { success: true, output: 'No active goals to review.' };
        }

        const response = await context.llm.chat([
            { role: 'user', content: `Review these goals and suggest improvements:\n\n${goals}` },
        ]);

        return { success: true, output: response };
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// GOALS.LIST — Custom logic (filtering/sorting), stays as service tool
// ─────────────────────────────────────────────────────────────────────────────

registerServiceTool({
    name: 'goals.list',
    description: 'List all goals in the current project',
    type: 'deterministic',
    inputSchema: {
        type: 'object',
        properties: {
            status: { type: 'string', description: 'Filter by status' },
            priority: { type: 'string', description: 'Filter by priority' },
        },
    },
    execute: async (input, context): Promise<ServiceToolResult> => {
        const { status, priority } = (input as { status?: string; priority?: string }) || {};

        context.log.info('Listing goals');

        const entities = await listEntities('goal');

        const goals = entities
            .filter(e => !status || e.meta.status === status)
            .filter(e => !priority || e.meta.priority === priority)
            .map(e => ({
                title: e.meta.title as string,
                filepath: e.filepath,
                status: e.meta.status as string,
                priority: e.meta.priority as string,
                smart: e.meta.smart as Partial<SmartFields> | undefined,
                milestones: e.meta.milestones as string[] | undefined,
            }));

        return { success: true, output: { goals } };
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// GOALS.GET — Custom logic (reads full content), stays as service tool
// ─────────────────────────────────────────────────────────────────────────────

registerServiceTool({
    name: 'goals.get',
    description: 'Get a specific goal by title',
    type: 'deterministic',
    inputSchema: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'Goal title', required: true },
        },
        required: ['title'],
    },
    execute: async (input, context): Promise<ServiceToolResult> => {
        const { title } = input as { title: string };

        context.log.info(`Getting goal: ${title}`);

        const found = await findEntityByTitle('goal', title);
        if (!found) {
            return { success: false, output: null, error: `Goal "${title}" not found` };
        }

        return {
            success: true,
            output: {
                title: found.meta.title,
                content: found.content,
                status: found.meta.status,
                priority: found.meta.priority,
                smart: found.meta.smart,
                milestones: found.meta.milestones,
            },
            canvasUpdate: {
                type: 'goal',
                title: found.meta.title as string,
                content: found.content,
                metadata: {
                    status: found.meta.status,
                    priority: found.meta.priority,
                    smart: found.meta.smart,
                },
                dirty: false,
            },
        };
    },
});
