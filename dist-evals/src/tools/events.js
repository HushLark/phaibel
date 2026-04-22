import path from 'path';
import { promises as fs } from 'fs';
import matter from 'gray-matter';
import { getEntityDir, } from '../entities/entity.js';
import { registerServiceTool } from './types.js';
// ─────────────────────────────────────────────────────────────────────────────
// EVENTS.REVIEW — AI review (needs LLM proxy + complex event merge logic)
// ─────────────────────────────────────────────────────────────────────────────
registerServiceTool({
    name: 'events.review',
    description: 'Review events with AI for scheduling advice',
    type: 'ai',
    capability: 'reason',
    inputSchema: {
        type: 'object',
        properties: {
            startDate: { type: 'string', description: 'Filter from date (YYYY-MM-DD)' },
            endDate: { type: 'string', description: 'Filter to date (YYYY-MM-DD)' },
        },
    },
    execute: async (input, context) => {
        const { startDate, endDate } = input;
        context.log.info('Reviewing events schedule');
        // Gather project + global events
        let projectDir;
        try {
            projectDir = await getEntityDir('event');
        }
        catch {
            return { success: true, output: 'No project set — cannot review events.' };
        }
        const globalDir = path.join(process.env.HOME || '~', '.phaibel', 'vault', 'global', 'events');
        const allEvents = [];
        for (const [dir, scope] of [[projectDir, 'project'], [globalDir, 'global']]) {
            try {
                const files = await fs.readdir(dir);
                for (const f of files.filter(f => f.endsWith('.md'))) {
                    const raw = await fs.readFile(path.join(dir, f), 'utf-8');
                    const { data } = matter(raw);
                    const ev = {
                        title: data.title,
                        startDate: data.startDate,
                        endDate: data.endDate,
                        location: data.location,
                        recurring: data.recurring,
                        scope,
                    };
                    // Date filter
                    if (startDate && ev.startDate < startDate)
                        continue;
                    if (endDate && ev.endDate > endDate)
                        continue;
                    allEvents.push(ev);
                }
            }
            catch { /* dir may not exist */ }
        }
        if (allEvents.length === 0) {
            return { success: true, output: 'No events found in the specified range.' };
        }
        // Sort by start date
        allEvents.sort((a, b) => a.startDate.localeCompare(b.startDate));
        const eventList = allEvents.map(e => {
            const parts = [`- ${e.title} (${e.startDate} → ${e.endDate}) [${e.scope}]`];
            if (e.location)
                parts[0] += ` @ ${e.location}`;
            if (e.recurring)
                parts[0] += ` 🔄 ${e.recurring}`;
            return parts[0];
        }).join('\n');
        const response = await context.llm.chat([
            { role: 'user', content: `Review my schedule and suggest scheduling improvements:\n\n${eventList}` },
        ]);
        return { success: true, output: response };
    },
});
// ─────────────────────────────────────────────────────────────────────────────
// EVENTS.LIST — Custom logic (project + global merge), stays as service tool
// ─────────────────────────────────────────────────────────────────────────────
registerServiceTool({
    name: 'events.list',
    description: 'List all events (project + global)',
    type: 'deterministic',
    inputSchema: {
        type: 'object',
        properties: {
            startDate: { type: 'string', description: 'Filter from date (YYYY-MM-DD)' },
            endDate: { type: 'string', description: 'Filter to date (YYYY-MM-DD)' },
        },
    },
    execute: async (input, context) => {
        const { startDate, endDate } = input;
        context.log.info('Listing events');
        let projectDir;
        try {
            projectDir = await getEntityDir('event');
        }
        catch {
            return { success: true, output: { events: [] } };
        }
        const globalDir = path.join(process.env.HOME || '~', '.phaibel', 'vault', 'global', 'events');
        const events = [];
        for (const [dir, scope] of [[projectDir, 'project'], [globalDir, 'global']]) {
            try {
                const files = await fs.readdir(dir);
                for (const f of files.filter(f => f.endsWith('.md'))) {
                    const filepath = path.join(dir, f);
                    const raw = await fs.readFile(filepath, 'utf-8');
                    const { data } = matter(raw);
                    const ev = {
                        title: data.title,
                        startDate: data.startDate,
                        endDate: data.endDate,
                        location: data.location,
                        recurring: data.recurring,
                        scope,
                        filepath,
                    };
                    if (startDate && ev.startDate < startDate)
                        continue;
                    if (endDate && ev.endDate > endDate)
                        continue;
                    events.push(ev);
                }
            }
            catch { /* dir may not exist */ }
        }
        events.sort((a, b) => a.startDate.localeCompare(b.startDate));
        return { success: true, output: { events } };
    },
});
