// ─────────────────────────────────────────────────────────────────────────────
// Generic Entity CRUD Command
// Handles any user-defined entity type: `phaibel entity <type> [list|add|remove|show]`
// The shell maps `car add` → `entity car add` automatically.
// ─────────────────────────────────────────────────────────────────────────────

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import path from 'path';
import { getEntityType, type FieldDef } from '../entities/entity-type-config.js';
import {
    createEntityMeta,
    ensureEntityDir,
    writeEntity,
    generateEntityId,
    findEntityByTitle,
    trashEntity,
    listEntities,
    entityFilename,
} from '../entities/entity.js';
import { getEntityIndex } from '../entities/entity-index.js';

// ─────────────────────────────────────────────────────────────────────────────
// FIELD PROMPTS
// ─────────────────────────────────────────────────────────────────────────────

async function promptForField(field: FieldDef): Promise<unknown> {
    if (field.type === 'enum' && field.values?.length) {
        const choices = field.values.map(v => ({ name: v, value: v }));
        const { value } = await inquirer.prompt([{
            type: 'list',
            name: 'value',
            message: `  ${field.label ?? field.key}:`,
            choices,
            default: field.default ?? field.values[0],
        }]);
        return value;
    }

    if (field.type === 'boolean') {
        const { value } = await inquirer.prompt([{
            type: 'confirm',
            name: 'value',
            message: `  ${field.label ?? field.key}:`,
            default: field.default ?? false,
        }]);
        return value;
    }

    const { value } = await inquirer.prompt([{
        type: 'input',
        name: 'value',
        message: `  ${field.label ?? field.key}${field.required ? '' : ' (optional)'}:`,
        default: field.default as string ?? undefined,
        validate: field.required
            ? (v: string) => v.trim().length > 0 || `${field.label ?? field.key} is required`
            : undefined,
    }]);

    if (!value.trim() && !field.required) return undefined;

    if (field.type === 'number') return Number(value.trim()) || undefined;
    return value.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

async function addEntity(typeName: string, titleArg?: string): Promise<void> {
    const typeConfig = await getEntityType(typeName);
    if (!typeConfig) {
        console.log(chalk.red(`\n  Unknown entity type: "${typeName}"`));
        console.log(chalk.gray('  Run: phaibel type list'));
        return;
    }

    console.log(chalk.cyan(`\n🤖 Adding a new ${typeName}...\n`));

    // Title
    let title = titleArg?.trim();
    if (!title) {
        const answer = await inquirer.prompt([{
            type: 'input',
            name: 'title',
            message: `  Title / name:`,
            validate: (v: string) => v.trim().length > 0 || 'Title is required',
        }]);
        title = answer.title.trim();
    }

    // Prompt for each field defined on the type
    const fieldValues: Record<string, unknown> = {};
    const required = typeConfig.fields.filter(f => f.required);
    const optional = typeConfig.fields.filter(f => !f.required);

    if (required.length > 0) {
        console.log(chalk.gray('\n  Required fields:'));
        for (const field of required) {
            fieldValues[field.key] = await promptForField(field);
        }
    }

    if (optional.length > 0) {
        console.log(chalk.gray('\n  Optional fields (press Enter to skip):'));
        for (const field of optional) {
            const val = await promptForField(field);
            if (val !== undefined) fieldValues[field.key] = val;
        }
    }

    // Build and write entity
    const dir = await ensureEntityDir(typeName);
    const meta = createEntityMeta(typeName, title!);
    const id = meta.id;
    const filepath = path.join(dir, entityFilename(title!, id));

    const fullMeta: Record<string, unknown> = { ...meta, ...fieldValues };
    await writeEntity(filepath, fullMeta, '');

    // Update index
    const index = getEntityIndex();
    if (index.isBuilt) await index.addOrUpdate(typeName, id, title!, filepath);

    console.log(chalk.green(`\n  ✓ ${capitalize(typeName)} "${title}" saved.`));
}

async function listEntity(typeName: string): Promise<void> {
    const typeConfig = await getEntityType(typeName);
    if (!typeConfig) {
        console.log(chalk.red(`\n  Unknown entity type: "${typeName}"`));
        return;
    }

    const entities = await listEntities(typeName);
    if (entities.length === 0) {
        console.log(chalk.gray(`\n  No ${typeConfig.plural} found in this project.\n`));
        return;
    }

    console.log(chalk.cyan(`\n  ${capitalize(typeConfig.plural)} (${entities.length}):\n`));
    for (const e of entities) {
        const title = String(e.meta.title ?? '(untitled)');
        const id = String(e.meta.id ?? '');

        // Show completion state if configured
        let statusTag = '';
        if (typeConfig.completionField) {
            const val = e.meta[typeConfig.completionField];
            if (val === typeConfig.completionValue) {
                statusTag = chalk.gray(' [done]');
            } else {
                statusTag = chalk.gray(` [${val}]`);
            }
        }

        // Show a few key fields inline
        const extras = typeConfig.fields
            .filter(f => f.required && e.meta[f.key] !== undefined)
            .slice(0, 3)
            .map(f => chalk.gray(`${f.key}: ${e.meta[f.key]}`))
            .join('  ');

        console.log(`  ${chalk.bold(title)}${statusTag}`);
        if (extras) console.log(`    ${extras}`);
        if (id) console.log(chalk.gray(`    id: ${id}`));
    }
    console.log('');
}

async function removeEntity(typeName: string, titleArg?: string): Promise<void> {
    const typeConfig = await getEntityType(typeName);
    if (!typeConfig) {
        console.log(chalk.red(`\n  Unknown entity type: "${typeName}"`));
        return;
    }

    let title = titleArg?.trim();
    if (!title) {
        const entities = await listEntities(typeName);
        if (entities.length === 0) {
            console.log(chalk.gray(`\n  No ${typeConfig.plural} to remove.\n`));
            return;
        }
        const { picked } = await inquirer.prompt([{
            type: 'list',
            name: 'picked',
            message: `  Which ${typeName} to remove?`,
            choices: entities.map(e => ({ name: String(e.meta.title ?? e.meta.id), value: String(e.meta.title ?? e.meta.id) })),
        }]);
        title = picked;
    }

    const found = await findEntityByTitle(typeName, title!);
    if (!found) {
        console.log(chalk.red(`\n  ${capitalize(typeName)} "${title}" not found.\n`));
        return;
    }

    const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: chalk.yellow(`  Remove ${typeName} "${title}"?`),
        default: false,
    }]);

    if (!confirm) { console.log(chalk.gray('  Cancelled.')); return; }

    await trashEntity(found.filepath);

    const index = getEntityIndex();
    if (index.isBuilt) {
        const id = String(found.meta.id ?? '');
        if (id) index.remove(typeName, id);
    }

    console.log(chalk.green(`\n  ✓ ${capitalize(typeName)} "${title}" removed.\n`));
}

async function showEntity(typeName: string, titleArg?: string): Promise<void> {
    const typeConfig = await getEntityType(typeName);
    if (!typeConfig) {
        console.log(chalk.red(`\n  Unknown entity type: "${typeName}"`));
        return;
    }

    let title = titleArg?.trim();
    if (!title) {
        const entities = await listEntities(typeName);
        if (entities.length === 0) {
            console.log(chalk.gray(`\n  No ${typeConfig.plural} found.\n`));
            return;
        }
        const { picked } = await inquirer.prompt([{
            type: 'list',
            name: 'picked',
            message: `  Which ${typeName}?`,
            choices: entities.map(e => ({ name: String(e.meta.title ?? e.meta.id), value: String(e.meta.title ?? e.meta.id) })),
        }]);
        title = picked;
    }

    const found = await findEntityByTitle(typeName, title!);
    if (!found) {
        console.log(chalk.red(`\n  ${capitalize(typeName)} "${title}" not found.\n`));
        return;
    }

    console.log(chalk.cyan(`\n  ${capitalize(typeName)}: ${chalk.bold(String(found.meta.title))}\n`));
    for (const field of typeConfig.fields) {
        const val = found.meta[field.key];
        if (val !== undefined) {
            console.log(`  ${chalk.gray(field.label ?? field.key + ':')} ${val}`);
        }
    }
    if (found.content) {
        console.log(chalk.gray('\n  Notes:'));
        console.log(`  ${found.content}`);
    }
    console.log('');
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMAND
// ─────────────────────────────────────────────────────────────────────────────

export const entityCommand = new Command('entity')
    .description('CRUD for any entity type (used internally by the shell)')
    .argument('<type>', 'Entity type name (e.g. car, music)')
    .argument('[action]', 'Action: list, add, remove, show', 'list')
    .argument('[title]', 'Entity title (optional for add, required for show/remove)')
    .action(async (type: string, action: string, title?: string) => {
        switch (action) {
            case 'add':    await addEntity(type, title); break;
            case 'list':   await listEntity(type); break;
            case 'remove':
            case 'rm':     await removeEntity(type, title); break;
            case 'show':   await showEntity(type, title); break;
            default:
                console.log(chalk.red(`\n  Unknown action "${action}". Use: list, add, remove, show\n`));
        }
    });
