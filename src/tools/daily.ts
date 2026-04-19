import { promises as fs } from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { getVaultRoot } from '../state/manager.js';
import { registerServiceTool, type ServiceToolResult } from './types.js';
import { debug } from '../utils/debug.js';

// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
}

function getDayName(date: Date): string {
    return date.toLocaleDateString('en-US', { weekday: 'long' });
}

interface DailyItem {
    type: 'task' | 'note' | 'event' | 'research';
    title: string;
    content: string;
    metadata?: Record<string, unknown>;
}

async function gatherVaultData(
    vaultRoot: string,
    targetDate: string
): Promise<DailyItem[]> {
    const items: DailyItem[] = [];

    // Gather tasks
    const todosPath = path.join(vaultRoot, 'todos');
    try {
        const files = await fs.readdir(todosPath);
        for (const file of files) {
            if (!file.endsWith('.md') || file.startsWith('.')) continue;

            const filepath = path.join(todosPath, file);
            const fileContent = await fs.readFile(filepath, 'utf-8');
            const { data, content } = matter(fileContent);

            if (!data.completed && (!data.dueDate || data.dueDate <= targetDate)) {
                items.push({
                    type: 'task',
                    title: data.title || path.basename(file, '.md'),
                    content,
                    metadata: {
                        priority: data.priority,
                        dueDate: data.dueDate,
                    },
                });
            }
        }
    } catch (err) {
        debug('daily', err);
    }

    // Gather events for target date
    const eventsPath = path.join(vaultRoot, 'events');
    try {
        const files = await fs.readdir(eventsPath);
        for (const file of files) {
            if (!file.endsWith('.md') || file.startsWith('.')) continue;

            const filepath = path.join(eventsPath, file);
            const fileContent = await fs.readFile(filepath, 'utf-8');
            const { data, content } = matter(fileContent);

            if (data.date === targetDate) {
                items.push({
                    type: 'event',
                    title: data.title || path.basename(file, '.md'),
                    content,
                    metadata: {
                        date: data.date,
                        time: data.time,
                        duration: data.duration,
                        location: data.location,
                    },
                });
            }
        }
    } catch (err) {
        debug('daily', err);
    }

    // Gather active research
    const researchPath = path.join(vaultRoot, 'research');
    try {
        const files = await fs.readdir(researchPath);
        for (const file of files) {
            if (!file.endsWith('.md') || file.startsWith('.')) continue;

            const filepath = path.join(researchPath, file);
            const fileContent = await fs.readFile(filepath, 'utf-8');
            const { data, content } = matter(fileContent);

            if (data.status === 'in-progress') {
                items.push({
                    type: 'research',
                    title: data.title || path.basename(file, '.md'),
                    content,
                    metadata: {
                        status: data.status,
                    },
                });
            }
        }
    } catch (err) {
        debug('daily', err);
    }

    // Gather recent notes (created or updated today)
    const notesPath = path.join(vaultRoot, 'notes');
    try {
        const files = await fs.readdir(notesPath);
        for (const file of files) {
            if (!file.endsWith('.md') || file.startsWith('.')) continue;

            const filepath = path.join(notesPath, file);
            const fileContent = await fs.readFile(filepath, 'utf-8');
            const { data, content } = matter(fileContent);

            const created = data.created ? data.created.split('T')[0] : null;
            const updated = data.updated ? data.updated.split('T')[0] : null;

            if (created === targetDate || updated === targetDate) {
                items.push({
                    type: 'note',
                    title: data.title || path.basename(file, '.md'),
                    content,
                    metadata: {
                        created: data.created,
                        updated: data.updated,
                    },
                });
            }
        }
    } catch (err) {
        debug('daily', err);
    }

    return items;
}

async function generateDailySummary(
    targetDate: string,
    items: DailyItem[],
    context: import('./types.js').ServiceToolExecutionContext
): Promise<string> {
    const dayName = getDayName(new Date(targetDate));

    // Sort items: events by time, then tasks by priority
    const events = items.filter(i => i.type === 'event').sort((a, b) => {
        const timeA = (a.metadata?.time as string) || '00:00';
        const timeB = (b.metadata?.time as string) || '00:00';
        return timeA.localeCompare(timeB);
    });

    const tasks = items.filter(i => i.type === 'task').sort((a, b) => {
        const priority = { high: 0, medium: 1, low: 2 };
        const pA = priority[(a.metadata?.priority as keyof typeof priority) || 'medium'];
        const pB = priority[(b.metadata?.priority as keyof typeof priority) || 'medium'];
        return pA - pB;
    });

    const research = items.filter(i => i.type === 'research');
    const notes = items.filter(i => i.type === 'note');

    const fullContext = await context.ctx.getFullContext('todos');

    // Build prompt
    let prompt = `Create a helpful daily summary for ${dayName}, ${targetDate}.

`;

    if (events.length > 0) {
        prompt += `## Schedule\n`;
        for (const e of events) {
            prompt += `- ${e.metadata?.time || 'TBD'}: ${e.title}${e.metadata?.location ? ` @ ${e.metadata.location}` : ''}\n`;
        }
        prompt += '\n';
    }

    if (tasks.length > 0) {
        prompt += `## Tasks\n`;
        for (const t of tasks) {
            const priorityEmoji = { high: '🔴', medium: '🟡', low: '🟢' };
            prompt += `- ${priorityEmoji[(t.metadata?.priority as keyof typeof priorityEmoji) || 'medium']} ${t.title}${t.metadata?.dueDate ? ` (due: ${t.metadata.dueDate})` : ''}\n`;
        }
        prompt += '\n';
    }

    if (research.length > 0) {
        prompt += `## Active Research\n`;
        for (const r of research) {
            prompt += `- ${r.title}\n`;
        }
        prompt += '\n';
    }

    if (notes.length > 0) {
        prompt += `## Recent Notes\n`;
        for (const n of notes) {
            prompt += `- ${n.title}\n`;
        }
        prompt += '\n';
    }

    if (items.length === 0) {
        prompt += `No items scheduled for this day.\n`;
    }

    prompt += `\nProvide a prioritized summary with helpful suggestions for the day. Be concise and encouraging.`;

    const summary = await context.llm.chat([
        { role: 'system', content: fullContext.combined },
        { role: 'user', content: prompt },
    ]);

    return summary;
}

async function saveDailyFile(vaultRoot: string, date: string, summary: string): Promise<string> {
    const dailyPath = path.join(vaultRoot, 'daily');
    await fs.mkdir(dailyPath, { recursive: true });

    const filepath = path.join(dailyPath, `${date}.md`);

    const frontmatter = {
        date,
        created: new Date().toISOString(),
    };

    const content = matter.stringify(summary, frontmatter);
    await fs.writeFile(filepath, content);

    return filepath;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED DAILY GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

async function generateDailyForDate(
    date: Date,
    input: { save?: boolean },
    context: import('./types.js').ServiceToolExecutionContext
): Promise<ServiceToolResult> {
    const { save = true } = input;
    const targetDate = formatDate(date);

    context.log.info(`Generating daily summary for ${targetDate}`);

    const vaultRoot = await getVaultRoot();
    const allItems = await gatherVaultData(vaultRoot, targetDate);

    context.log.info(`Found ${allItems.length} items for ${targetDate}`);

    // Generate AI summary
    const summary = await generateDailySummary(targetDate, allItems, context);

    let filepath: string | undefined;
    if (save) {
        filepath = await saveDailyFile(vaultRoot, targetDate, summary);
        context.log.info(`Saved to ${filepath}`);
    }

    return {
        success: true,
        output: {
            date: targetDate,
            dayName: getDayName(date),
            itemCount: allItems.length,
            items: allItems,
            summary,
            filepath,
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// DAILY.TODAY - Review all projects and create today's summary
// ─────────────────────────────────────────────────────────────────────────────

registerServiceTool({
    name: 'daily.today',
    description: 'Review all entities and create today\'s summary markdown file',
    type: 'ai',
    capability: 'summarize',
    inputSchema: {
        type: 'object',
        properties: {
            save: { type: 'boolean', description: 'Save the summary to daily folder' },
        },
    },
    execute: async (input, context): Promise<ServiceToolResult> => {
        const opts = input as { save?: boolean };
        return generateDailyForDate(new Date(), opts, context);
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// DAILY.TOMORROW - Review all projects and create tomorrow's summary
// ─────────────────────────────────────────────────────────────────────────────

registerServiceTool({
    name: 'daily.tomorrow',
    description: 'Review all entities and create tomorrow\'s summary markdown file',
    type: 'ai',
    capability: 'summarize',
    inputSchema: {
        type: 'object',
        properties: {
            save: { type: 'boolean', description: 'Save the summary to daily folder' },
        },
    },
    execute: async (input, context): Promise<ServiceToolResult> => {
        const opts = input as { save?: boolean };
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return generateDailyForDate(tomorrow, opts, context);
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// DAILY.GET - Get a specific day's summary
// ─────────────────────────────────────────────────────────────────────────────

registerServiceTool({
    name: 'daily.get',
    description: 'Get a specific day\'s summary',
    type: 'deterministic',
    inputSchema: {
        type: 'object',
        properties: {
            date: { type: 'string', description: 'Date to get (YYYY-MM-DD)', required: true },
        },
        required: ['date'],
    },
    execute: async (input, context): Promise<ServiceToolResult> => {
        const { date } = input as { date: string };

        context.log.info(`Getting daily summary for ${date}`);

        const vaultRoot = await getVaultRoot();
        const filepath = path.join(vaultRoot, 'daily', `${date}.md`);

        try {
            const fileContent = await fs.readFile(filepath, 'utf-8');
            const { data, content } = matter(fileContent);

            return {
                success: true,
                output: {
                    date,
                    filepath,
                    summary: content,
                    created: data.created,
                },
            };
        } catch (err) {
            debug('daily', err);
            return {
                success: false,
                output: null,
                error: `No summary found for ${date}`,
            };
        }
    },
});
