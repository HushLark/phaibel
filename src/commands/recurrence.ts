import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { promises as fs } from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { getVaultRoot } from '../state/manager.js';
import {
    slugify,
    generateEntityId,
    ensureEntityDir,
    trashEntity,
    entityFilename,
} from '../entities/entity.js';
import { getEntityType } from '../entities/entity-type-config.js';
import { spawn, type BlackoutWindow, type CadenceDetails } from '../entities/spawner.js';
import { listEntities as listEntitiesDisplay } from './list.js';
import { getResponse } from '../responses.js';
import { debug } from '../utils/debug.js';
import { getEntityIndex } from '../entities/entity-index.js';

// Kept for backwards compat in this file
type RecurrenceCadence = 'daily' | 'weekly' | 'monthly';
type RecurrenceTargetType = 'task' | 'event';

const DAYS_OF_WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Map legacy 'todo' to the actual entity type name 'task'. */
function normalizeTargetType(value: string): RecurrenceTargetType {
    if (value === 'todo') return 'task';
    return value as RecurrenceTargetType;
}

// Re-export from extracted module (avoids pulling commander into Expo)
import { ensureRecurrenceType } from '../entities/recurrence-type.js';
export { ensureRecurrenceType };

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface RecurrenceState {
    title: string;
    recurrenceType: RecurrenceTargetType;
    cadence: RecurrenceCadence;
    cadenceDetails: CadenceDetails;
    priority?: string;
    blackoutWindows: BlackoutWindow[];
    body: string;
    filepath?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE I/O
// ─────────────────────────────────────────────────────────────────────────────

async function saveRecurrence(state: RecurrenceState): Promise<string> {
    await ensureRecurrenceType();
    const dir = await ensureEntityDir('recurrence');

    let filepath = state.filepath;
    let entityId: string;
    if (filepath) {
        const raw = await fs.readFile(filepath, 'utf-8');
        const parsed = matter(raw);
        entityId = (parsed.data.id as string) ?? path.basename(filepath, '.md');
    } else {
        entityId = generateEntityId('recurrence');
        filepath = path.join(dir, entityFilename(state.title, entityId));
    }

    const meta: Record<string, unknown> = {
        id: entityId,
        title: state.title,
        entityType: 'recurrence',
        recurrenceType: state.recurrenceType,
        cadence: state.cadence,
        cadenceDetails: state.cadenceDetails,
        tags: ['recurrence'],
        created: new Date().toISOString(),
    };
    if (state.priority) meta.priority = state.priority;
    if (state.blackoutWindows.length > 0) meta.blackoutWindows = state.blackoutWindows;

    const fileContent = matter.stringify(state.body, meta);
    await fs.writeFile(filepath, fileContent);

    // Update entity index
    const index = getEntityIndex();
    if (index.isBuilt) {
        await index.addOrUpdate('recurrence', entityId, state.title, filepath);
    }

    return filepath;
}

async function loadAllRecurrences(): Promise<RecurrenceState[]> {
    const vaultRoot = await getVaultRoot();
    const dir = path.join(vaultRoot, 'recurrences');

    let files: string[];
    try {
        files = (await fs.readdir(dir)).filter(f => f.endsWith('.md'));
    } catch {
        return [];
    }

    const recurrences: RecurrenceState[] = [];
    for (const file of files) {
        const filepath = path.join(dir, file);
        const raw = await fs.readFile(filepath, 'utf-8');
        const { data, content } = matter(raw);
        recurrences.push({
            title: data.title ?? file.replace('.md', ''),
            recurrenceType: normalizeTargetType(data.recurrenceType ?? data.targetType ?? 'task'),
            cadence: data.cadence ?? 'monthly',
            cadenceDetails: data.cadenceDetails ?? {},
            priority: data.priority,
            blackoutWindows: data.blackoutWindows ?? [],
            body: content.trim(),
            filepath,
        });
    }
    return recurrences;
}

async function findRecurrence(name: string): Promise<RecurrenceState | null> {
    const all = await loadAllRecurrences();
    const slug = slugify(name);
    return all.find(r =>
        slugify(r.title) === slug ||
        r.title.toLowerCase() === name.toLowerCase(),
    ) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERATE CONCRETE ENTITIES (delegates to generic spawner)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// HEADLESS GENERATE (reusable from cron scheduler and CLI)
// ─────────────────────────────────────────────────────────────────────────────

export interface GenerateRecurrencesResult {
    created: number;
    skipped: number;
}

/**
 * Generate concrete entities from recurrence templates.
 * Headless — no console output. Throws on fatal errors.
 */
export async function generateRecurrences(days?: number): Promise<GenerateRecurrencesResult> {
    await ensureRecurrenceType();
    const daysAhead = days ?? 60;
    const recurrences = await loadAllRecurrences();
    if (recurrences.length === 0) {
        return { created: 0, skipped: 0 };
    }

    const recurrenceTypeConfig = await getEntityType('recurrence');
    if (!recurrenceTypeConfig?.spawner) {
        throw new Error('Recurrence spawner config not found in entity-types.json.');
    }
    const spawnerConfig = recurrenceTypeConfig.spawner;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + daysAhead);

    let totalCreated = 0;
    let totalSkipped = 0;

    for (const rec of recurrences) {
        if (!rec.filepath) continue;

        const template = {
            filepath: rec.filepath,
            content: rec.body,
            meta: {
                title: rec.title,
                entityType: 'recurrence',
                targetType: rec.recurrenceType,
                cadence: rec.cadence,
                cadenceDetails: rec.cadenceDetails,
                priority: rec.priority,
                blackoutWindows: rec.blackoutWindows,
            } as Record<string, unknown>,
        };

        const result = await spawn(template, spawnerConfig, { startDate: today, endDate });
        totalCreated += result.created;
        totalSkipped += result.skipped;
    }

    return { created: totalCreated, skipped: totalSkipped };
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERACTIVE CREATE
// ─────────────────────────────────────────────────────────────────────────────

async function interactiveCreate(): Promise<void> {
    const { title } = await inquirer.prompt([{
        type: 'input',
        name: 'title',
        message: 'Recurrence name (e.g. "Pay rent"):',
        validate: (i: string) => i.length > 0 || 'Title is required',
    }]);

    const { recurrenceType } = await inquirer.prompt([{
        type: 'list',
        name: 'recurrenceType',
        message: 'What type of entity does this create?',
        choices: [
            { name: 'Task — recurring task', value: 'task' },
            { name: 'Event — recurring event with times', value: 'event' },
        ],
    }]);

    const { cadence } = await inquirer.prompt([{
        type: 'list',
        name: 'cadence',
        message: 'How often does it repeat?',
        choices: [
            { name: 'Daily', value: 'daily' },
            { name: 'Weekly', value: 'weekly' },
            { name: 'Monthly', value: 'monthly' },
        ],
    }]);

    const cadenceDetails: CadenceDetails = {};

    if (cadence === 'weekly') {
        const { dayOfWeek } = await inquirer.prompt([{
            type: 'list',
            name: 'dayOfWeek',
            message: 'Which day of the week?',
            choices: DAYS_OF_WEEK.map(d => ({ name: d.charAt(0).toUpperCase() + d.slice(1), value: d })),
        }]);
        cadenceDetails.dayOfWeek = dayOfWeek;
    }

    if (cadence === 'monthly') {
        const { dayOfMonth } = await inquirer.prompt([{
            type: 'input',
            name: 'dayOfMonth',
            message: 'Day of month (1-31):',
            default: '1',
            validate: (i: string) => {
                const n = parseInt(i);
                return (n >= 1 && n <= 31) || 'Enter a day between 1 and 31';
            },
        }]);
        cadenceDetails.dayOfMonth = parseInt(dayOfMonth);
    }

    let priority: string | undefined;
    if (recurrenceType === 'task') {
        const { p } = await inquirer.prompt([{
            type: 'list',
            name: 'p',
            message: 'Default priority for generated todos?',
            choices: ['low', 'medium', 'high'],
            default: 'medium',
        }]);
        priority = p;
    }

    if (recurrenceType === 'event') {
        const { startTime } = await inquirer.prompt([{
            type: 'input',
            name: 'startTime',
            message: 'Start time (HH:mm):',
            default: '09:00',
            validate: (i: string) => /^\d{2}:\d{2}$/.test(i) || 'Use HH:mm format',
        }]);
        const { endTime } = await inquirer.prompt([{
            type: 'input',
            name: 'endTime',
            message: 'End time (HH:mm):',
            default: '10:00',
            validate: (i: string) => /^\d{2}:\d{2}$/.test(i) || 'Use HH:mm format',
        }]);
        cadenceDetails.startTime = startTime;
        cadenceDetails.endTime = endTime;

        const { location } = await inquirer.prompt([{
            type: 'input',
            name: 'location',
            message: 'Location (optional):',
        }]);
        if (location) cadenceDetails.location = location;
    }

    // ── Blackout windows ───────────────────────────────────────────────
    const blackoutWindows: BlackoutWindow[] = [];
    let addingBlackouts = true;
    const { wantBlackouts } = await inquirer.prompt([{
        type: 'confirm',
        name: 'wantBlackouts',
        message: 'Add blackout windows (dates to skip)?',
        default: false,
    }]);

    if (wantBlackouts) {
        while (addingBlackouts) {
            const { start } = await inquirer.prompt([{
                type: 'input',
                name: 'start',
                message: 'Blackout start date (YYYY-MM-DD):',
                validate: (i: string) => /^\d{4}-\d{2}-\d{2}$/.test(i) || 'Use YYYY-MM-DD',
            }]);
            const { end } = await inquirer.prompt([{
                type: 'input',
                name: 'end',
                message: 'Blackout end date (YYYY-MM-DD):',
                default: start,
                validate: (i: string) => /^\d{4}-\d{2}-\d{2}$/.test(i) || 'Use YYYY-MM-DD',
            }]);
            const { reason } = await inquirer.prompt([{
                type: 'input',
                name: 'reason',
                message: 'Reason (optional):',
            }]);

            blackoutWindows.push({ start, end, reason: reason || undefined });

            const { more } = await inquirer.prompt([{
                type: 'confirm',
                name: 'more',
                message: 'Add another blackout window?',
                default: false,
            }]);
            addingBlackouts = more;
        }
    }

    // ── Body ───────────────────────────────────────────────────────────
    const { body } = await inquirer.prompt([{
        type: 'editor',
        name: 'body',
        message: 'Template body (copied into each concrete entity):',
    }]);

    const state: RecurrenceState = {
        title,
        recurrenceType,
        cadence,
        cadenceDetails,
        priority,
        blackoutWindows,
        body: body.trim(),
    };

    const filepath = await saveRecurrence(state);
    console.log(chalk.green(`\n✓ Recurrence "${title}" saved → ${filepath}`));
}

// ─────────────────────────────────────────────────────────────────────────────
// EDIT
// ─────────────────────────────────────────────────────────────────────────────

async function editRecurrence(name: string): Promise<void> {
    const rec = await findRecurrence(name);
    if (!rec) {
        console.log(chalk.red(`\nRecurrence "${name}" not found.`));
        return;
    }

    console.log(chalk.cyan(`\nEditing recurrence: "${rec.title}"`));

    const { field } = await inquirer.prompt([{
        type: 'list',
        name: 'field',
        message: 'What would you like to edit?',
        choices: [
            { name: 'Title', value: 'title' },
            { name: 'Body (template content)', value: 'body' },
            { name: 'Priority', value: 'priority' },
            { name: 'Blackout windows', value: 'blackouts' },
        ],
    }]);

    switch (field) {
        case 'title': {
            const { newTitle } = await inquirer.prompt([{
                type: 'input', name: 'newTitle', message: 'New title:', default: rec.title,
            }]);
            rec.title = newTitle;
            break;
        }
        case 'body': {
            const { newBody } = await inquirer.prompt([{
                type: 'editor', name: 'newBody', message: 'Edit body:', default: rec.body,
            }]);
            rec.body = newBody.trim();
            break;
        }
        case 'priority': {
            const { newPriority } = await inquirer.prompt([{
                type: 'list', name: 'newPriority', message: 'Priority:',
                choices: ['low', 'medium', 'high'], default: rec.priority ?? 'medium',
            }]);
            rec.priority = newPriority;
            break;
        }
        case 'blackouts': {
            console.log(chalk.gray(`\nCurrent blackout windows: ${rec.blackoutWindows.length}`));
            rec.blackoutWindows.forEach((w, i) => {
                console.log(chalk.gray(`  ${i + 1}. ${w.start} → ${w.end}${w.reason ? ` (${w.reason})` : ''}`));
            });
            const { action } = await inquirer.prompt([{
                type: 'list', name: 'action', message: 'Action:',
                choices: [
                    { name: 'Add a window', value: 'add' },
                    { name: 'Clear all windows', value: 'clear' },
                    { name: 'Cancel', value: 'cancel' },
                ],
            }]);
            if (action === 'add') {
                const { start } = await inquirer.prompt([{
                    type: 'input', name: 'start', message: 'Start (YYYY-MM-DD):',
                    validate: (i: string) => /^\d{4}-\d{2}-\d{2}$/.test(i) || 'Use YYYY-MM-DD',
                }]);
                const { end } = await inquirer.prompt([{
                    type: 'input', name: 'end', message: 'End (YYYY-MM-DD):', default: start,
                    validate: (i: string) => /^\d{4}-\d{2}-\d{2}$/.test(i) || 'Use YYYY-MM-DD',
                }]);
                const { reason } = await inquirer.prompt([{
                    type: 'input', name: 'reason', message: 'Reason (optional):',
                }]);
                rec.blackoutWindows.push({ start, end, reason: reason || undefined });
            } else if (action === 'clear') {
                rec.blackoutWindows = [];
            }
            break;
        }
    }

    await saveRecurrence(rec);
    console.log(chalk.green(`✓ Recurrence "${rec.title}" updated.`));
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────────────────────────────────────

async function deleteRecurrence(name: string): Promise<void> {
    const rec = await findRecurrence(name);
    if (!rec) {
        console.log(chalk.red(`\nRecurrence "${name}" not found.`));
        return;
    }

    const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: `Delete recurrence "${rec.title}"?`,
        default: false,
    }]);

    if (confirm && rec.filepath) {
        // Read id from frontmatter before trashing
        const raw = await fs.readFile(rec.filepath, 'utf-8');
        const recId = (matter(raw).data.id as string) ?? path.basename(rec.filepath, '.md');
        const trashPath = await trashEntity(rec.filepath);

        // Update entity index
        const index = getEntityIndex();
        if (index.isBuilt) {
            index.remove('recurrence', recId);
        }

        console.log(chalk.green(`🗑  Moved to trash: ${rec.title}`));
        console.log(chalk.gray(`  ${trashPath}`));
    } else {
        console.log(chalk.gray('Cancelled.'));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMAND
// ─────────────────────────────────────────────────────────────────────────────

export const recurrenceCommand = new Command('recurrence')
    .description('Manage recurring todos and events')
    .argument('[action]', 'create | list | edit | delete | generate')
    .argument('[args...]', 'Name for edit/delete, or days for generate')
    .action(async (action?: string, args?: string[]) => {
        try {
            switch (action) {
                case 'create':
                    await interactiveCreate();
                    break;

                case 'list':
                    await listEntitiesDisplay('recurrences');
                    break;

                case 'edit': {
                    const name = args?.join(' ');
                    if (!name) {
                        console.log(chalk.yellow('Usage: recurrence edit <name>'));
                        return;
                    }
                    await editRecurrence(name);
                    break;
                }

                case 'delete':
                case 'remove': {
                    const name = args?.join(' ');
                    if (!name) {
                        console.log(chalk.yellow('Usage: recurrence delete <name>'));
                        return;
                    }
                    await deleteRecurrence(name);
                    break;
                }

                case 'generate': {
                    const days = args?.[0] ? parseInt(args[0]) : 60;
                    if (isNaN(days) || days < 1) {
                        console.log(chalk.yellow('Provide a valid number of days (default: 60).'));
                        return;
                    }
                    console.log(chalk.gray(`\nGenerating concrete entities for the next ${days} days...`));
                    const result = await generateRecurrences(days);
                    console.log(chalk.green(`\n✓ Generated ${result.created} concrete entities (${result.skipped} skipped/blacked-out)`));
                    break;
                }

                default:
                    console.log(chalk.cyan(`\n🔄 Recurrence commands:\n`));
                    console.log(`  ${chalk.bold('create')}    - Create a new recurrence`);
                    console.log(`  ${chalk.bold('list')}      - List all recurrences`);
                    console.log(`  ${chalk.bold('edit')}      - Edit a recurrence`);
                    console.log(`  ${chalk.bold('delete')}    - Delete a recurrence`);
                    console.log(`  ${chalk.bold('generate')}  - Generate concrete entities (default: 60 days)`);
                    console.log('');
                    break;
            }
        } catch (error) {
            console.error(chalk.red(getResponse('error')), error);
        }
    });

export default recurrenceCommand;
