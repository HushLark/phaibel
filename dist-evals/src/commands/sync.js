import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getVaultRoot } from '../state/manager.js';
import { getResponse } from '../responses.js';
const execAsync = promisify(exec);
export const syncCommand = new Command('sync')
    .description('Sync with GitHub')
    .option('-m, --message <message>', 'Commit message', 'Phaibel synced notes')
    .action(async (options) => {
    const spinner = ora(getResponse('sync_start')).start();
    try {
        const cwd = await getVaultRoot();
        // Pull first
        spinner.text = 'Pulling latest changes...';
        try {
            await execAsync('git pull', { cwd });
        }
        catch (error) {
            // Pull might fail if no upstream, that's okay
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (!errorMessage.includes('no tracking information')) {
                throw error;
            }
        }
        // Check for changes
        spinner.text = 'Checking for changes...';
        const { stdout: status } = await execAsync('git status --porcelain', { cwd });
        if (!status.trim()) {
            spinner.succeed('Everything is up to date, sir!');
            return;
        }
        // Add all changes
        spinner.text = 'Adding changes...';
        await execAsync('git add .', { cwd });
        // Commit
        spinner.text = 'Committing...';
        const timestamp = new Date().toISOString();
        await execAsync(`git commit -m "${options.message} - ${timestamp}"`, { cwd });
        // Push
        spinner.text = 'Pushing to GitHub...';
        try {
            await execAsync('git push', { cwd });
            spinner.succeed(getResponse('sync_complete'));
        }
        catch (error) {
            // Push might fail if no upstream set
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('no upstream')) {
                spinner.warn('Changes committed but not pushed. Set upstream with: git push -u origin main');
            }
            else {
                throw error;
            }
        }
        // Show what was synced
        const lines = status.trim().split('\n');
        console.log(chalk.gray(`\n  ${lines.length} file(s) synced`));
    }
    catch (error) {
        spinner.fail(getResponse('error'));
        console.error(chalk.red('\nError:'), error);
    }
});
export default syncCommand;
