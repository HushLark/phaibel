import chalk from 'chalk';
import { promises as fs } from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { getVaultRoot } from '../state/manager.js';

/**
 * Supported entity types and their corresponding subdirectory names.
 */
export type EntityType = 'notes' | 'todos' | 'events' | 'research' | 'goals' | 'recurrences' | 'people' | 'todonts';

const ENTITY_ICONS: Record<EntityType, string> = {
    notes: '📝',
    todos: '✅',
    events: '📅',
    research: '📚',
    goals: '🎯',
    recurrences: '🔄',
    people: '👤',
    todonts: '🚫',
};

/**
 * List all entities of a given type for the active project.
 * Reads .md files from `projects/<project>/<entityType>/`, parses
 * gray-matter frontmatter, and prints a styled table.
 */
export async function listEntities(entityType: EntityType): Promise<void> {
    const vaultRoot = await getVaultRoot();
    const dir = path.join(vaultRoot, entityType);

    let files: string[];
    try {
        files = (await fs.readdir(dir)).filter(f => f.endsWith('.md'));
    } catch {
        console.log(chalk.gray(`\nNo ${entityType} found.`));
        return;
    }

    if (files.length === 0) {
        console.log(chalk.gray(`\nNo ${entityType} found.`));
        return;
    }

    // Parse frontmatter from each file
    const items = await Promise.all(
        files.map(async file => {
            const raw = await fs.readFile(path.join(dir, file), 'utf-8');
            const { data } = matter(raw);
            return { file, data };
        }),
    );

    const icon = ENTITY_ICONS[entityType];
    console.log(chalk.cyan(`\n${icon} ${capitalize(entityType)} (${items.length})\n`));

    // ── Type-specific rendering ────────────────────────────────────────
    switch (entityType) {
        case 'todos':
            printTodos(items);
            break;
        case 'events':
            printEvents(items);
            break;
        case 'recurrences':
            printRecurrences(items);
            break;
        case 'people':
            printPeople(items);
            break;
        case 'todonts':
            printTodonts(items);
            break;
        default:
            // notes & research share the same simple layout
            printSimple(items);
            break;
    }

    console.log('');
}

/* ── Renderers ─────────────────────────────────────────────────────── */

function printSimple(items: { file: string; data: Record<string, any> }[]): void {
    for (const { file, data } of items) {
        const title = data.title ?? file.replace('.md', '');
        const created = data.created ?? '';

        console.log(
            `  ${chalk.bold.white(title)}` +
            (created ? chalk.gray(`  ${created}`) : ''),
        );
    }
}

function printTodos(items: { file: string; data: Record<string, any> }[]): void {
    const priorityColors: Record<string, (s: string) => string> = {
        high: chalk.red,
        medium: chalk.yellow,
        low: chalk.gray,
    };

    for (const { file, data } of items) {
        const title = data.title ?? file.replace('.md', '');
        const done = data.completed;
        const statusIcon = done ? '✅' : '⬜';
        const priority = data.priority ?? 'medium';
        const colorFn = priorityColors[priority] ?? chalk.white;
        const due = data.dueDate ? chalk.gray(`  due ${data.dueDate}`) : '';

        console.log(
            `  ${statusIcon} ${chalk.bold.white(title)} ${colorFn(`[${priority}]`)}${due}`,
        );
    }
}

function printEvents(items: { file: string; data: Record<string, any> }[]): void {
    for (const { file, data } of items) {
        const title = data.title ?? file.replace('.md', '');
        const start = data.startTime ? formatShort(data.startTime) : '';
        const location = data.location ?? '';

        console.log(
            `  ${chalk.bold.white(title)}` +
            (start ? chalk.gray(`  🕐 ${start}`) : '') +
            (location ? chalk.gray(`  📍 ${location}`) : ''),
        );
    }
}

function printRecurrences(items: { file: string; data: Record<string, any> }[]): void {
    for (const { file, data } of items) {
        const title = data.title ?? file.replace('.md', '');
        const type = data.recurrenceType === 'event' ? '📅' : '✅';
        const cadence = data.cadence ?? '?';
        const blackouts = Array.isArray(data.blackoutWindows) ? data.blackoutWindows.length : 0;

        console.log(
            `  ${type} ${chalk.bold.white(title)}` +
            chalk.gray(`  ${cadence}`) +
            (blackouts > 0 ? chalk.gray(`  ⛔ ${blackouts} blackout${blackouts > 1 ? 's' : ''}`) : ''),
        );
    }
}

function printPeople(items: { file: string; data: Record<string, any> }[]): void {
    for (const { file, data } of items) {
        const title = data.title ?? file.replace('.md', '');
        const company = data.company ?? '';
        const handle = data.handle ?? '';
        const email = data.email ?? '';

        console.log(
            `  ${chalk.bold.white(title)}` +
            (company ? chalk.gray(`  🏢 ${company}`) : '') +
            (handle ? chalk.cyan(`  @${handle}`) : '') +
            (email ? chalk.gray(`  ✉ ${email}`) : ''),
        );
    }
}

function printTodonts(items: { file: string; data: Record<string, any> }[]): void {
    const today = new Date().toISOString().split('T')[0];
    for (const { file, data } of items) {
        const title = data.title ?? file.replace('.md', '');
        const start = data.startDate as string | undefined;
        const end = data.endDate as string | undefined;

        // Determine if active
        let active = true;
        if (start && today < start) active = false;
        if (end && today > end) active = false;

        const icon = active ? '🚫' : '⏸️';
        let window = chalk.gray('always');
        if (start && end) window = chalk.gray(`${start} → ${end}`);
        else if (start) window = chalk.gray(`from ${start}`);
        else if (end) window = chalk.gray(`until ${end}`);

        console.log(
            `  ${icon} ${active ? chalk.bold.red(title) : chalk.gray(title)}  ${window}`,
        );
    }
}

/* ── Helpers ────────────────────────────────────────────────────────── */

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatShort(iso: string): string {
    try {
        return new Date(iso).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        });
    } catch {
        return iso;
    }
}
