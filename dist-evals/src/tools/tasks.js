import { listEntities, } from '../entities/entity.js';
import { registerServiceTool } from './types.js';
// ─────────────────────────────────────────────────────────────────────────────
// TASKS.REVIEW — AI review (needs LLM proxy, stays as service tool)
// ─────────────────────────────────────────────────────────────────────────────
registerServiceTool({
    name: 'tasks.review',
    description: 'Review tasks with AI for prioritization advice',
    type: 'ai',
    capability: 'reason',
    inputSchema: {
        type: 'object',
        properties: {
            onlyOverdue: { type: 'boolean', description: 'Focus on overdue tasks' },
        },
    },
    execute: async (input, context) => {
        const { onlyOverdue = false } = input;
        context.log.info('Reviewing tasks with AI');
        const entities = await listEntities('task');
        const tasks = entities
            .filter(e => e.meta.status !== 'done')
            .filter(e => {
            if (!onlyOverdue)
                return true;
            const due = e.meta.dueDate;
            return due && new Date(due) < new Date();
        })
            .map(e => ({
            title: e.meta.title,
            status: e.meta.status,
            priority: e.meta.priority,
            dueDate: e.meta.dueDate,
            tags: e.meta.tags || [],
        }));
        if (tasks.length === 0) {
            return { success: true, output: 'No open tasks to review.' };
        }
        const taskList = tasks.map(t => {
            const parts = [`- ${t.title} [${t.status}/${t.priority}]`];
            if (t.dueDate)
                parts[0] += ` due: ${t.dueDate}`;
            return parts[0];
        }).join('\n');
        const response = await context.llm.chat([
            { role: 'user', content: `Please review these tasks and provide prioritization advice:\n\n${taskList}` },
        ]);
        return { success: true, output: response };
    },
});
// ─────────────────────────────────────────────────────────────────────────────
// TASKS.LIST — Custom logic (filtering/sorting), stays as service tool
// ─────────────────────────────────────────────────────────────────────────────
registerServiceTool({
    name: 'tasks.list',
    description: 'List all tasks in the current project',
    type: 'deterministic',
    inputSchema: {
        type: 'object',
        properties: {
            includeCompleted: { type: 'boolean', description: 'Include done tasks' },
        },
    },
    execute: async (input, context) => {
        const { includeCompleted = false } = input;
        context.log.info('Listing tasks');
        const entities = await listEntities('task');
        const tasks = entities
            .filter(e => includeCompleted || e.meta.status !== 'done')
            .map(e => ({
            title: e.meta.title,
            filepath: e.filepath,
            status: e.meta.status,
            priority: e.meta.priority,
            dueDate: e.meta.dueDate,
            tags: e.meta.tags || [],
        }))
            .sort((a, b) => {
            const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
            const pDiff = (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
            if (pDiff !== 0)
                return pDiff;
            if (a.dueDate && b.dueDate)
                return a.dueDate.localeCompare(b.dueDate);
            return a.dueDate ? -1 : b.dueDate ? 1 : 0;
        });
        return { success: true, output: { tasks } };
    },
});
