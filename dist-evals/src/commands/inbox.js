import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { promises as fs } from 'fs';
import path from 'path';
import { getVaultRoot } from '../state/manager.js';
import { getResponse } from '../responses.js';
import { debug } from '../utils/debug.js';
import { bootstrapFeral } from '../feral/bootstrap.js';
const CATEGORY_ICONS = {
    note: '📝',
    task: '✅',
    event: '📅',
    research: '📚',
    goal: '🎯',
    person: '👤',
};
const CATEGORY_LABELS = {
    note: 'Note',
    task: 'Todo',
    event: 'Event',
    research: 'Research',
    goal: 'Goal',
    person: 'Person',
};
async function processInboxItem(itemPath) {
    const filename = path.basename(itemPath);
    const ext = path.extname(filename).toLowerCase();
    // Skip binary files
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
        console.log(chalk.yellow(`  ⚠ Image files need manual classification: ${filename}`));
        return { success: false, entities: [] };
    }
    // Check if file is empty
    const content = await fs.readFile(itemPath, 'utf-8');
    if (!content.trim()) {
        console.log(chalk.yellow(`  ⚠ Empty file skipped: ${filename}`));
        return { success: false, entities: [] };
    }
    // Bootstrap Feral and run the import process
    const feral = await bootstrapFeral();
    let ctx;
    try {
        ctx = await feral.runner.run('inbox.import', {
            file_path: itemPath,
            filename,
        });
    }
    catch (err) {
        debug('inbox', err);
        console.log(chalk.red(`  ✗ Process error: ${err instanceof Error ? err.message : String(err)}`));
        return { success: false, entities: [] };
    }
    // Extract what was created from the context
    const entities = ctx.getArray('entities');
    const createdEntities = [];
    if (entities && entities.length > 0) {
        const vaultRoot = await getVaultRoot();
        for (const entity of entities) {
            const icon = CATEGORY_ICONS[entity.category] || '📄';
            const label = CATEGORY_LABELS[entity.category] || entity.category;
            console.log(chalk.green(`  ${icon} ${chalk.bold(label)}: ${entity.title}`));
            createdEntities.push({ category: entity.category, title: entity.title });
        }
        // Remove source file after successful processing
        await fs.unlink(itemPath);
    }
    return { success: createdEntities.length > 0, entities: createdEntities };
}
// ─────────────────────────────────────────────────────────────────────────────
// LIST INBOX ITEMS
// ─────────────────────────────────────────────────────────────────────────────
async function listInboxItems() {
    const vaultRoot = await getVaultRoot();
    const inboxDir = path.join(vaultRoot, 'inbox');
    try {
        const files = await fs.readdir(inboxDir);
        return files
            .filter(f => !f.startsWith('.'))
            .map(f => path.join(inboxDir, f));
    }
    catch (err) {
        debug('inbox', err);
        return [];
    }
}
/**
 * Process all inbox items headlessly (no interactive prompts).
 * Failed items are silently skipped and left in the inbox.
 */
export async function processInbox() {
    const items = await listInboxItems();
    let processed = 0;
    let skipped = 0;
    for (const itemPath of items) {
        try {
            const result = await processInboxItem(itemPath);
            if (result.success) {
                processed += result.entities.length;
            }
            else {
                skipped++;
            }
        }
        catch {
            skipped++;
        }
    }
    return { processed, skipped };
}
// ─────────────────────────────────────────────────────────────────────────────
// COMMAND
// ─────────────────────────────────────────────────────────────────────────────
export const inboxCommand = new Command('inbox')
    .description('Import inbox items via Feral process (LLM classification + entity creation)')
    .argument('[action]', 'Action: process (default) or add')
    .argument('[content]', 'File path or text content to add')
    .action(async (action, content) => {
    try {
        const vaultRoot = await getVaultRoot();
        const inboxDir = path.join(vaultRoot, 'inbox');
        // Ensure inbox directory exists
        await fs.mkdir(inboxDir, { recursive: true });
        if (action === 'add' && content) {
            // Add content to inbox
            const today = new Date().toISOString().split('T')[0];
            const timestamp = Date.now();
            // Check if content is a file path
            try {
                const stat = await fs.stat(content);
                if (stat.isFile()) {
                    const ext = path.extname(content);
                    const destPath = path.join(inboxDir, `${today}-${timestamp}${ext}`);
                    await fs.copyFile(content, destPath);
                    const msg = getResponse('task_saved');
                    console.log(chalk.green(`\n${msg}`));
                    console.log(chalk.gray(`  Added file to inbox: ${path.basename(destPath)}`));
                    return;
                }
            }
            catch (err) {
                debug('inbox', err);
            }
            // Add as text file
            const textPath = path.join(inboxDir, `${today}-${timestamp}.txt`);
            await fs.writeFile(textPath, content);
            const msg = getResponse('task_saved');
            console.log(chalk.green(`\n${msg}`));
            console.log(chalk.gray(`  Added text to inbox: ${path.basename(textPath)}`));
            return;
        }
        // Process inbox items
        const items = await listInboxItems();
        if (items.length === 0) {
            const msg = getResponse('inbox_empty');
            console.log(chalk.gray(`\n📥 ${msg}`));
            console.log(chalk.gray('\nTo add items:'));
            console.log(chalk.gray('  phaibel inbox add "Remember to call mom"'));
            console.log(chalk.gray('  phaibel inbox add /path/to/file.txt'));
            return;
        }
        const processingMsg = getResponse('inbox_processing');
        console.log(chalk.cyan(`\n📥 ${processingMsg}`));
        console.log(chalk.gray(`   ${items.length} file(s) found in inbox\n`));
        let totalEntities = 0;
        let skippedFiles = 0;
        for (const itemPath of items) {
            const filename = path.basename(itemPath);
            console.log(chalk.cyan(`─── ${filename} ───`));
            try {
                const result = await processInboxItem(itemPath);
                if (result.success) {
                    totalEntities += result.entities.length;
                }
                else {
                    // Ask user what to do with failed items
                    const { userAction } = await inquirer.prompt([{
                            type: 'list',
                            name: 'userAction',
                            message: `Could not process "${filename}". What should be done?`,
                            choices: [
                                { name: 'Skip (keep in inbox)', value: 'skip' },
                                { name: 'Delete from inbox', value: 'delete' },
                            ],
                        }]);
                    if (userAction === 'delete') {
                        await fs.unlink(itemPath);
                        console.log(chalk.yellow(`  🗑 Deleted: ${filename}`));
                    }
                    else {
                        skippedFiles++;
                    }
                }
            }
            catch (error) {
                console.error(chalk.red(`  ✗ Error processing ${filename}:`), error);
                skippedFiles++;
            }
        }
        const doneMsg = getResponse('inbox_complete');
        console.log(chalk.cyan(`\n✓ ${doneMsg}`));
        console.log(chalk.gray(`   ${totalEntities} entities created${skippedFiles > 0 ? `, ${skippedFiles} files skipped` : ''}`));
    }
    catch (error) {
        const errMsg = getResponse('error');
        console.error(chalk.red(`\n${errMsg}`), error);
    }
});
export default inboxCommand;
