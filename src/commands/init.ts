import { Command } from 'commander';
import { debug } from '../utils/debug.js';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { findFoundationRoot } from '../state/manager.js';
import { loadEntityTypes } from '../entities/entity-type-config.js';
import { writeAllContextTypes } from '../cxms/context-type-store.js';
import { setApiKey, PROVIDER_MODELS, getConfiguredProviders } from '../config.js';
import { startDaemon } from '../service/daemon.js';
import { SYSTEM_DIR } from '../paths.js';

export const initCommand = new Command('init')
    .description('Initialize a new Phaibel Foundation in the current directory')
    .action(async () => {
        const cwd = process.cwd();

        // Reject init inside the system directory
        const systemDir = path.join(os.homedir(), '.phaibel');
        if (cwd === systemDir || path.basename(cwd) === '.phaibel') {
            console.log(chalk.red('System directories are reserved for configuration.'));
            console.log(chalk.gray('Please run `phaibel init` from a different directory.'));
            return;
        }

        const foundationPath = path.join(cwd, '.cxms.md');

        // Check if already a foundation
        const existingRoot = await findFoundationRoot();
        if (existingRoot === cwd) {
            console.log(chalk.yellow('This directory is already a Phaibel Foundation.'));
            return;
        }

        if (existingRoot) {
            console.log(chalk.yellow(`A parent Foundation exists at: ${existingRoot}`));
            console.log(chalk.gray('Creating a Foundation here would create a nested Foundation.'));
            return;
        }

        // Check if .cxms.md already exists
        try {
            await fs.access(foundationPath);
            console.log(chalk.yellow('.cxms.md already exists. This is already a Foundation.'));
            return;
        } catch {
            // Good, doesn't exist
        }

        console.log(chalk.gray('Creating a new Phaibel Foundation...'));

        const today = new Date().toISOString().split('T')[0];
        const foundationName = path.basename(cwd);

        // Create root .cxms.md
        const rootFile = `---
title: "${foundationName}"
created: ${today}
tags: [context, system, root]
---

# ${foundationName}

## Agent

This Foundation is managed by a Personal Digital Agent that helps you get organised and manage your time. The agent's personality and name are configured during the onboarding interview.

## Memory

This Foundation is the agent's memory. Content is stored as Markdown files with YAML frontmatter, organised by context type (tasks, events, notes, goals, people, etc.). All content can be linked in a knowledge graph — context nodes are vertices, references are edges. The agent should proactively link related content and use these connections to give better advice.

## Rules

- All files use YAML frontmatter for structured metadata
- Prefer creating context nodes over giving advice — if the user describes something actionable, make it
- Link related content when the connection is clear (task → goal, person → event, etc.)
- Be concise in responses — the user values their time
- When presenting lists, keep them scannable
- Reference content by name so the user knows exactly what changed

## User Preferences

- Timezone: Local machine time
- Date format: YYYY-MM-DD
`;
        await fs.writeFile(foundationPath, rootFile);

        // Ensure ~/.phaibel/ exists for secrets
        await fs.mkdir(SYSTEM_DIR(), { recursive: true });

        // Create v5 directory structure
        const v5Dirs = [
            'profiles',
            'context-types',
            'collections',
            'logs',
            'feral',
            'feral/processes',
            'feral/logs',
            'feral/catalog',
            '.phaibel',     // vault-scoped config (secrets ref, legacy compat)
        ];
        for (const dir of v5Dirs) {
            await fs.mkdir(path.join(cwd, dir), { recursive: true });
        }

        // Seed context types from defaults
        const entityTypes = await loadEntityTypes();
        // Update directories to v5 format
        const contextTypes = entityTypes.map(t => ({
            ...t,
            directory: `context-types/${t.name}`,
        }));
        await writeAllContextTypes(contextTypes);

        // Create context type node directories
        for (const t of contextTypes) {
            await fs.mkdir(path.join(cwd, t.directory), { recursive: true });
        }

        // Create .gitignore
        const gitignore = `.state.json
.phaibel/
.v5-migrated
logs/
.DS_Store
`;
        try {
            await fs.access(path.join(cwd, '.gitignore'));
            await fs.appendFile(path.join(cwd, '.gitignore'), '\n' + gitignore);
        } catch {
            await fs.writeFile(path.join(cwd, '.gitignore'), gitignore);
        }

        console.log(chalk.green('\n✓ Foundation created!'));
        console.log(chalk.gray(`\nCreated:`));
        console.log(chalk.gray(`  .cxms.md             - Root context`));
        console.log(chalk.gray(`  profiles/            - User & agent profiles`));
        console.log(chalk.gray(`  context-types/       - Context type schemas`));
        for (const t of contextTypes) {
            console.log(chalk.gray(`    ${t.name}/`));
        }
        console.log(chalk.gray(`  collections/         - Key/value collections`));
        console.log(chalk.gray(`  feral/               - Feral CCF engine`));

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
