import { Command } from 'commander';
import { debug } from '../utils/debug.js';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { findVaultRoot } from '../state/manager.js';
import { initEntityTypes, loadEntityTypes } from '../entities/entity-type-config.js';
import { setApiKey, PROVIDER_MODELS, getConfiguredProviders } from '../config.js';
import { startDaemon } from '../service/daemon.js';
import { SYSTEM_DIR } from '../paths.js';

export const initCommand = new Command('init')
    .description('Initialize a new phaibel vault in the current directory')
    .action(async () => {
        const cwd = process.cwd();

        // Reject init inside the system directory
        const systemDir = path.join(os.homedir(), '.phaibel');
        if (cwd === systemDir || path.basename(cwd) === '.phaibel') {
            console.log(chalk.red('System directories are reserved for configuration.'));
            console.log(chalk.gray('Please run `phaibel init` from a different directory.'));
            return;
        }

        const vaultFilePath = path.join(cwd, '.vault.md');

        // Check if already a vault
        const existingVault = await findVaultRoot();
        if (existingVault === cwd) {
            console.log(chalk.yellow('This directory is already an phaibel vault.'));
            return;
        }

        if (existingVault) {
            console.log(chalk.yellow(`A parent vault exists at: ${existingVault}`));
            console.log(chalk.gray('Creating a vault here would create a nested vault.'));
            return;
        }

        // Check if .vault.md already exists
        try {
            await fs.access(vaultFilePath);
            console.log(chalk.yellow('.vault.md already exists. This is already a vault.'));
            return;
        } catch {
            // Good, doesn't exist
        }

        console.log(chalk.gray('Creating a new phaibel vault...'));

        const today = new Date().toISOString().split('T')[0];
        const vaultName = path.basename(cwd);

        // Create root .vault.md
        const rootVaultFile = `---
title: "${vaultName} Vault"
created: ${today}
tags: [context, system, root]
---

# ${vaultName}

## Agent

This vault is managed by a Personal Digital Agent that helps you get organised and manage your time. The agent's personality and name are configured during the onboarding interview.

## Memory

This vault is the agent's memory. Content is stored as Markdown files with YAML frontmatter, organised by type (tasks, events, notes, goals, people, etc.). All content can be linked in a knowledge graph — content items are nodes, relationships are edges. The agent should proactively link related content and use these connections to give better advice.

## Rules

- All files use YAML frontmatter for structured metadata
- Prefer creating entities over giving advice — if the user describes something actionable, make it
- Link related content when the connection is clear (task → goal, person → event, etc.)
- Be concise in responses — the user values their time
- When presenting lists, keep them scannable
- Reference content by name so the user knows exactly what changed

## User Preferences

- Timezone: Local machine time
- Date format: YYYY-MM-DD
`;
        await fs.writeFile(vaultFilePath, rootVaultFile);

        // Ensure ~/.phaibel/ exists for secrets
        await fs.mkdir(SYSTEM_DIR, { recursive: true });

        // Create vault-scoped .phaibel/ for config, logs, processes
        await fs.mkdir(path.join(cwd, '.phaibel'), { recursive: true });

        // Seed entity-types.json in vault/.phaibel/
        await initEntityTypes();

        // Create entity type directories directly in vault root
        const entityTypes = await loadEntityTypes();
        const folders = entityTypes.map(t => t.directory);
        // Always include inbox (not an entity type but used for quick capture)
        if (!folders.includes('inbox')) folders.push('inbox');

        for (const folder of folders) {
            await fs.mkdir(path.join(cwd, folder), { recursive: true });
        }

        // Create .gitignore
        const gitignore = `.state.json
.phaibel/
.DS_Store
`;
        try {
            await fs.access(path.join(cwd, '.gitignore'));
            await fs.appendFile(path.join(cwd, '.gitignore'), '\n' + gitignore);
        } catch {
            await fs.writeFile(path.join(cwd, '.gitignore'), gitignore);
        }

        console.log(chalk.green('\n✓ Vault created!'));
        console.log(chalk.gray(`\nCreated:`));
        console.log(chalk.gray(`  .vault.md            - Root context`));
        for (const folder of folders) {
            console.log(chalk.gray(`  ${folder}/`));
        }

        // ── API key setup (only on first-ever init) ─────────────────
        const configured = await getConfiguredProviders();
        if (configured.length === 0) {
            console.log(chalk.cyan('\n🔑 An API key is needed for AI capabilities.\n'));

            const knownProviders = Object.keys(PROVIDER_MODELS);
            const { provider } = await inquirer.prompt([{
                type: 'list',
                name: 'provider',
                message: 'Which AI provider?',
                choices: knownProviders.map(p => ({ name: p, value: p })),
                default: 'openai',
            }]);

            const { apiKey } = await inquirer.prompt([{
                type: 'password',
                name: 'apiKey',
                message: `Enter ${provider} API key:`,
                mask: '*',
                validate: (input: string) => input.length > 0 || 'API key is required',
            }]);

            await setApiKey(provider, apiKey);
            console.log(chalk.green(`\n✓ ${provider} API key saved to ~/.phaibel/`));
        }

        // ── Start service and open web client ───────────────────────
        console.log(chalk.gray('\nStarting service...'));
        try {
            const status = await startDaemon();
            if (status.running) {
                console.log(chalk.green('✓ Service running!'));
                console.log(chalk.cyan('\n🤖 Open the web client to finish setup:'));
                console.log(chalk.cyan.bold('   http://localhost:3737\n'));
            } else {
                console.log(chalk.yellow('Service did not start.'));
                console.log(chalk.gray('Run `phaibel service start` then open http://localhost:3737'));
            }
        } catch (err) {
            debug('init', err);
            console.log(chalk.yellow('Could not auto-start service.'));
            console.log(chalk.gray('Run `phaibel service start` then open http://localhost:3737'));
        }
    });

export default initCommand;
