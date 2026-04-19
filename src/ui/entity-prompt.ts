import chalk from 'chalk';
import { breadcrumbPrompt } from './breadcrumb.js';

/**
 * Configuration for rendering an entity mode status bar header.
 * Each entity type provides its own config to show relevant metadata.
 */
export interface EntityHeaderConfig {
    /** Emoji icon for the entity type */
    icon: string;
    /** Entity type label (e.g., 'Note', 'Todo', 'Event') */
    type: string;
    /** Entity title */
    title: string;
    /** Key-value metadata pairs to display (e.g., priority, due date) */
    meta: Array<{ label: string; value: string; color?: (s: string) => string }>;
}

const MIN_WIDTH = 50;

/**
 * Renders a status bar header when entering/updating an entity mode.
 * 
 * Example output:
 * ┌─ 📝 Note · myrise-api ─────────────────────┐
 * │  "API Refactor"   lines: 12   new           │
 * └─────────────────────────────────────────────┘
 */
export function renderEntityHeader(config: EntityHeaderConfig): void {
    const { icon, type, title, meta } = config;

    // Build content lines
    const titleLine = `  "${title}"`;
    const metaStr = meta.map(m => {
        const val = m.color ? m.color(m.value) : m.value;
        return `${m.label}: ${val}`;
    }).join('   ');

    const contentLines: string[] = [];
    if (metaStr) {
        contentLines.push(`${titleLine}   ${metaStr}`);
    } else {
        contentLines.push(titleLine);
    }

    // Calculate box width based on longest visible line
    const headerLabel = ` ${icon} ${type} `;
    const visibleLengths = contentLines.map(l => stripAnsi(l).length + 4); // +4 for │ padding
    const headerLabelLen = stripAnsi(headerLabel).length + 4; // +4 for ┌─ and ─┐
    const maxContent = Math.max(...visibleLengths, headerLabelLen, MIN_WIDTH);
    const boxWidth = maxContent;

    // Top border with label
    const topPadding = boxWidth - stripAnsi(headerLabel).length - 2; // -2 for ┌ and ┐
    const topBorder = chalk.cyan(`┌─${headerLabel}${'─'.repeat(Math.max(0, topPadding))}┐`);

    // Content lines
    const formattedLines = contentLines.map(line => {
        const pad = boxWidth - stripAnsi(line).length - 2; // -2 for │ on each side
        return chalk.cyan('│') + line + ' '.repeat(Math.max(0, pad)) + chalk.cyan('│');
    });

    // Bottom border
    const bottomBorder = chalk.cyan(`└${'─'.repeat(boxWidth)}┘`);

    console.log('');
    console.log(topBorder);
    for (const line of formattedLines) {
        console.log(line);
    }
    console.log(bottomBorder);
}

/**
 * Returns the entity-mode prompt string for the interactive loop.
 * Uses the breadcrumb path so the prompt shows `🤖 phaibel.note>` etc.
 */
export function entityPrompt(_type: string): string {
    return breadcrumbPrompt();
}

// ── Helpers for Note ────────────────────────────────────

export function noteHeaderConfig(state: {
    title: string;
    content: string;
    isExisting: boolean;
}): EntityHeaderConfig {
    const lineCount = state.content ? state.content.split('\n').length : 0;
    return {
        icon: '📝',
        type: 'Note',
        title: state.title,
        meta: [
            { label: 'lines', value: String(lineCount) },
            { label: 'status', value: state.isExisting ? 'editing' : 'new', color: state.isExisting ? chalk.yellow : chalk.green },
        ],
    };
}

// ── Helpers for Todo ────────────────────────────────────

export function todoHeaderConfig(state: {
    title: string;
    priority: 'low' | 'medium' | 'high';
    dueDate?: string;
    isExisting: boolean;
    completed: boolean;
}): EntityHeaderConfig {
    const priorityColors: Record<string, (s: string) => string> = {
        low: chalk.gray,
        medium: chalk.yellow,
        high: chalk.red,
    };

    const status = state.completed ? 'done' : state.isExisting ? 'editing' : 'new';
    const statusColor = state.completed ? chalk.green : state.isExisting ? chalk.yellow : chalk.green;

    const meta: EntityHeaderConfig['meta'] = [
        { label: 'priority', value: state.priority, color: priorityColors[state.priority] },
        { label: 'status', value: status, color: statusColor },
    ];

    if (state.dueDate) {
        meta.push({ label: 'due', value: state.dueDate });
    }

    return {
        icon: '✅',
        type: 'Todo',
        title: state.title,
        meta,
    };
}

// ── Helpers for Event ───────────────────────────────────

export function eventHeaderConfig(state: {
    title: string;
    startTime: string;
    endTime: string;
    location?: string;
    isExisting: boolean;
}): EntityHeaderConfig {
    const formatShort = (iso: string) => {
        const d = new Date(iso);
        return d.toLocaleString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        });
    };

    const formatTime = (iso: string) => {
        const d = new Date(iso);
        return d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' });
    };

    const meta: EntityHeaderConfig['meta'] = [
        { label: 'status', value: state.isExisting ? 'editing' : 'new', color: state.isExisting ? chalk.yellow : chalk.green },
        { label: '🕐', value: `${formatShort(state.startTime)} → ${formatTime(state.endTime)}` },
    ];

    if (state.location) {
        meta.push({ label: '📍', value: state.location });
    }

    return {
        icon: '📅',
        type: 'Event',
        title: state.title,
        meta,
    };
}

/**
 * Strip ANSI escape codes for accurate length measurement.
 */
function stripAnsi(str: string): string {
    // eslint-disable-next-line no-control-regex
    return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}
