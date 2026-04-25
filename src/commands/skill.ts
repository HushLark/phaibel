// ─────────────────────────────────────────────────────────────────────────────
// SKILL COMMAND
// ─────────────────────────────────────────────────────────────────────────────
// Manage Phaibel skills (agentskills.io-compatible directories).
// ─────────────────────────────────────────────────────────────────────────────

import { Command } from 'commander';
import chalk from 'chalk';
import { loadSkillMetas, loadSkillManifest, createSkill } from '../skills/skill-manager.js';

export const skillCommand = new Command('skill')
    .description('Manage skills');

// ── list ─────────────────────────────────────────────────────────────────────

skillCommand
    .command('list')
    .description('Show all installed skills')
    .action(async () => {
        const metas = await loadSkillMetas();

        if (metas.length === 0) {
            console.log(chalk.yellow('\n  No skills installed.'));
            console.log(chalk.gray(`  Add a skill directory to {foundation}/skills/ with a SKILL.md file.\n`));
            return;
        }

        console.log(chalk.cyan('\n  Installed skills:\n'));
        for (const meta of metas) {
            const scripts = meta.scriptNames.length > 0
                ? chalk.gray(` [${meta.scriptNames.join(', ')}]`)
                : '';
            const tags = meta.tags.length > 0
                ? chalk.gray(` (${meta.tags.join(', ')})`)
                : '';
            console.log(`    ${chalk.bold(meta.name)}${tags}${scripts}`);
            console.log(`    ${chalk.gray(meta.description)}`);
            if (meta.triggers.length > 0) {
                console.log(`    ${chalk.gray('triggers: ' + meta.triggers.join(', '))}`);
            }
            console.log('');
        }
    });

// ── show ─────────────────────────────────────────────────────────────────────

skillCommand
    .command('show <name>')
    .description('Show the full manifest for a skill')
    .action(async (name: string) => {
        const metas = await loadSkillMetas();
        const meta = metas.find(m => m.name === name);
        if (!meta) {
            console.log(chalk.yellow(`\n  No skill found with name "${name}", sir.\n`));
            return;
        }
        const manifest = await loadSkillManifest(meta);
        console.log(chalk.cyan(`\n  ${manifest.name}`));
        console.log(chalk.gray(`  ${manifest.description}`));
        if (manifest.tags.length > 0) console.log(`  tags: ${manifest.tags.join(', ')}`);
        if (manifest.triggers.length > 0) console.log(`  triggers: ${manifest.triggers.join(', ')}`);
        if (manifest.scriptNames.length > 0) console.log(`  scripts: ${manifest.scriptNames.join(', ')}`);
        console.log('');
        console.log(manifest.body);
        console.log('');
    });

// ── create ───────────────────────────────────────────────────────────────────

skillCommand
    .command('create <name>')
    .description('Scaffold a new skill directory')
    .option('--description <desc>', 'Skill description', '')
    .action(async (name: string, opts: { description: string }) => {
        const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        const dir = await createSkill(safeName, opts.description || `${name} skill`);
        console.log(chalk.green(`\n  Skill "${safeName}" created at ${dir}`));
        console.log(chalk.gray(`  Edit SKILL.md and add Feral process JSON files to scripts/\n`));
    });

export default skillCommand;
