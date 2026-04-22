// ─────────────────────────────────────────────────────────────────────────────
// Entity Type Management — `phaibel type`
// Lets users list, add, edit, and remove custom entity types.
// ─────────────────────────────────────────────────────────────────────────────
import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { loadEntityTypes, addEntityType, updateEntityType, removeEntityType, } from '../entities/entity-type-config.js';
import { BUILT_IN_TYPE_NAMES } from '../entities/entity-types-defaults.js';
// ─────────────────────────────────────────────────────────────────────────────
// FIELD WIZARD
// ─────────────────────────────────────────────────────────────────────────────
const FIELD_TYPES = ['string', 'number', 'boolean', 'date', 'enum'];
async function askOneField(index, existing) {
    console.log(chalk.gray(`\n  Field ${index}${existing ? ` (${existing.key})` : ''}:`));
    const { key, label, type, required } = await inquirer.prompt([
        {
            type: 'input',
            name: 'key',
            message: '    Key (e.g. "email"):',
            default: existing?.key,
            validate: (v) => /^\w+$/.test(v.trim()) || 'Key must be a single word (letters, numbers, underscore)',
        },
        {
            type: 'input',
            name: 'label',
            message: '    Label:',
            default: (answers) => existing?.label ?? capitalize(answers.key.trim()),
        },
        {
            type: 'list',
            name: 'type',
            message: '    Type:',
            choices: FIELD_TYPES,
            default: existing?.type ?? 'string',
        },
        {
            type: 'confirm',
            name: 'required',
            message: '    Required?',
            default: existing?.required ?? false,
        },
    ]);
    const field = { key: key.trim(), label, type, required };
    if (type === 'enum') {
        const { valuesStr, defaultVal } = await inquirer.prompt([
            {
                type: 'input',
                name: 'valuesStr',
                message: '    Values (comma-separated):',
                default: existing?.values?.join(', ') ?? '',
                validate: (v) => v.trim().length > 0 || 'At least one value required',
            },
            {
                type: 'input',
                name: 'defaultVal',
                message: '    Default value:',
                default: existing?.default ?? '',
            },
        ]);
        field.values = valuesStr.split(',').map((v) => v.trim()).filter(Boolean);
        if (defaultVal.trim())
            field.default = defaultVal.trim();
    }
    return field;
}
async function askFields(existing = []) {
    const fields = [];
    let i = 1;
    if (existing.length > 0) {
        console.log(chalk.gray(`\n  Edit existing fields (press Enter to keep current values):\n`));
        for (const ef of existing) {
            const f = await askOneField(i++, ef);
            fields.push(f);
        }
        // Ask if they want to add more
        const { addMore } = await inquirer.prompt([{
                type: 'confirm',
                name: 'addMore',
                message: '  Add more fields?',
                default: false,
            }]);
        if (!addMore)
            return fields;
    }
    // Add new fields one at a time
    do {
        const f = await askOneField(i++);
        fields.push(f);
        const { another } = await inquirer.prompt([{
                type: 'confirm',
                name: 'another',
                message: '  Add another field?',
                default: false,
            }]);
        if (!another)
            break;
    } while (true);
    return fields;
}
// ─────────────────────────────────────────────────────────────────────────────
// TYPE WIZARD
// ─────────────────────────────────────────────────────────────────────────────
async function runTypeWizard(existing) {
    const isEdit = !!existing;
    const { name, plural, description, directory } = await inquirer.prompt([
        {
            type: 'input',
            name: 'name',
            message: 'Name (singular, e.g. "song"):',
            default: existing?.name ?? '',
            validate: (v) => /^[a-z][a-z0-9_-]*$/.test(v.trim()) || 'Lowercase letters, numbers, hyphens only',
            when: !isEdit, // can't rename an existing type
        },
        {
            type: 'input',
            name: 'plural',
            message: 'Plural (e.g. "songs"):',
            default: existing?.plural ?? '',
        },
        {
            type: 'input',
            name: 'description',
            message: 'Description:',
            default: existing?.description ?? '',
        },
        {
            type: 'input',
            name: 'directory',
            message: 'Directory (folder name in your project):',
            default: existing?.directory ?? '',
        },
    ]);
    const resolvedName = isEdit ? existing.name : name.trim();
    console.log(chalk.gray('\n  Now define the fields for this entity.'));
    console.log(chalk.gray('  Leave the key blank when you\'re done.\n'));
    const fields = await askFields(existing?.fields ?? []);
    // Completion field (optional)
    const enumFields = fields.filter(f => f.type === 'enum');
    let completionField;
    let completionValue;
    if (enumFields.length > 0) {
        const { hasCompletion } = await inquirer.prompt([{
                type: 'confirm',
                name: 'hasCompletion',
                message: 'Does this entity have a "done/complete" state to track?',
                default: existing?.completionField !== undefined,
            }]);
        if (hasCompletion) {
            const answers = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'completionField',
                    message: 'Which field tracks completion?',
                    choices: enumFields.map(f => ({ name: `${f.key} (${f.values?.join(', ')})`, value: f.key })),
                    default: existing?.completionField,
                },
                {
                    type: 'input',
                    name: 'completionValue',
                    message: 'What value means "complete"?',
                    default: existing?.completionValue ?? '',
                },
            ]);
            completionField = answers.completionField;
            completionValue = answers.completionValue.trim();
        }
    }
    const config = {
        name: resolvedName,
        plural: plural.trim() || resolvedName + 's',
        directory: directory.trim() || plural.trim() || resolvedName + 's',
        description: description.trim() || undefined,
        defaultTags: existing?.defaultTags ?? [resolvedName],
        fields,
    };
    if (completionField) {
        config.completionField = completionField;
        config.completionValue = completionValue;
    }
    return config;
}
// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
function printType(t) {
    const builtIn = BUILT_IN_TYPE_NAMES.has(t.name) ? chalk.gray(' (built-in)') : '';
    console.log(`  ${chalk.bold(t.name)}${builtIn} — ${t.plural} → ${chalk.gray(t.directory + '/')}`);
    if (t.description)
        console.log(chalk.gray(`    ${t.description}`));
    if (t.fields.length > 0) {
        const fieldList = t.fields.map(f => {
            const req = f.required ? '' : chalk.gray('?');
            const vals = f.type === 'enum' && f.values ? chalk.gray(` [${f.values.join('|')}]`) : '';
            return `${f.key}${req}:${f.type}${vals}`;
        }).join('  ');
        console.log(chalk.gray(`    fields: ${fieldList}`));
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// SUBCOMMANDS
// ─────────────────────────────────────────────────────────────────────────────
const listCmd = new Command('list')
    .description('List all entity types')
    .action(async () => {
    const types = await loadEntityTypes();
    console.log(chalk.cyan(`\n🤖 Entity types (${types.length}):\n`));
    for (const t of types)
        printType(t);
    console.log('');
});
const addCmd = new Command('add')
    .description('Add a new entity type')
    .action(async () => {
    console.log(chalk.cyan('\n🤖 Let\'s create a new entity type!\n'));
    const config = await runTypeWizard();
    await addEntityType(config);
    console.log(chalk.green(`\n✓ Entity type "${config.name}" created!`));
    console.log(chalk.gray(`  Use it with: phaibel chat — or via Feral flows.`));
});
const editCmd = new Command('edit')
    .description('Edit an existing entity type')
    .argument('<name>', 'Entity type name to edit')
    .action(async (name) => {
    const types = await loadEntityTypes();
    const existing = types.find(t => t.name === name);
    if (!existing) {
        console.log(chalk.red(`\n  Entity type "${name}" not found.`));
        const names = types.map(t => t.name).join(', ');
        console.log(chalk.gray(`  Available: ${names}`));
        return;
    }
    console.log(chalk.cyan(`\n🤖 Editing entity type "${name}".\n`));
    console.log(chalk.gray('  Press Enter to keep the current value.\n'));
    const config = await runTypeWizard(existing);
    await updateEntityType(name, config);
    console.log(chalk.green(`\n✓ Entity type "${name}" updated!`));
});
const removeCmd = new Command('remove')
    .alias('rm')
    .description('Remove a custom entity type')
    .argument('<name>', 'Entity type name to remove')
    .action(async (name) => {
    if (BUILT_IN_TYPE_NAMES.has(name)) {
        console.log(chalk.red(`\n  "${name}" is a built-in type and cannot be removed.`));
        return;
    }
    const types = await loadEntityTypes();
    const existing = types.find(t => t.name === name);
    if (!existing) {
        console.log(chalk.red(`\n  Entity type "${name}" not found.`));
        return;
    }
    const { confirm } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: chalk.yellow(`Remove entity type "${name}"? Existing files won't be deleted.`),
            default: false,
        }]);
    if (!confirm) {
        console.log(chalk.gray('  Cancelled.'));
        return;
    }
    await removeEntityType(name);
    console.log(chalk.green(`\n✓ Entity type "${name}" removed.`));
});
// ─────────────────────────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────────────────────────
export const entityTypeCommand = new Command('type')
    .description('Manage entity types (list, add, edit, remove)')
    .addCommand(listCmd)
    .addCommand(addCmd)
    .addCommand(editCmd)
    .addCommand(removeCmd);
