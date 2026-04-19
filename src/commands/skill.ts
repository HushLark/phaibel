// ─────────────────────────────────────────────────────────────────────────────
// SKILL COMMAND
// ─────────────────────────────────────────────────────────────────────────────
// Manage MCP skill servers — add, remove, list.
// ─────────────────────────────────────────────────────────────────────────────

import { Command } from 'commander';
import chalk from 'chalk';
import { loadSkillsConfig, saveSkillsConfig } from '../skills/skill-config.js';

export const skillCommand = new Command('skill')
    .description('Manage MCP skill servers');

// ── add ──────────────────────────────────────────────────────────────────────

skillCommand
    .command('add <name>')
    .description('Add an MCP skill server')
    .requiredOption('--command <cmd>', 'Command to spawn the MCP server')
    .option('--args <args...>', 'Arguments for the command')
    .option('--env <pairs...>', 'Environment variables as KEY=VAL pairs')
    .action(async (name: string, opts: { command: string; args?: string[]; env?: string[] }) => {
        const cfg = await loadSkillsConfig();
        const id = name.toLowerCase().replace(/[^a-z0-9-_]/g, '-');

        if (cfg.skills.some(s => s.id === id)) {
            console.log(chalk.yellow(`\n  A skill with id "${id}" already exists, sir.`));
            console.log(chalk.gray(`  Use ${chalk.bold(`phaibel skill remove ${id}`)} first, then re-add.\n`));
            return;
        }

        const env: Record<string, string> = {};
        if (opts.env) {
            for (const pair of opts.env) {
                const eqIdx = pair.indexOf('=');
                if (eqIdx > 0) {
                    env[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
                }
            }
        }

        cfg.skills.push({
            id,
            name,
            command: opts.command,
            args: opts.args ?? [],
            env,
        });
        await saveSkillsConfig(cfg);
        console.log(chalk.green(`\n  Skill "${name}" (${id}) added, sir.`));
        console.log(chalk.gray(`  It will be available next time the agent starts.\n`));
    });

// ── remove ───────────────────────────────────────────────────────────────────

skillCommand
    .command('remove <name>')
    .description('Remove an MCP skill server')
    .action(async (name: string) => {
        const cfg = await loadSkillsConfig();
        const idx = cfg.skills.findIndex(s => s.id === name || s.name === name);

        if (idx === -1) {
            console.log(chalk.yellow(`\n  No skill found with id or name "${name}", sir.\n`));
            return;
        }

        const removed = cfg.skills.splice(idx, 1)[0];
        await saveSkillsConfig(cfg);
        console.log(chalk.green(`\n  Skill "${removed.name}" (${removed.id}) removed, sir.\n`));
    });

// ── list ─────────────────────────────────────────────────────────────────────

skillCommand
    .command('list')
    .description('Show all configured MCP skill servers')
    .action(async () => {
        const cfg = await loadSkillsConfig();

        if (cfg.skills.length === 0) {
            console.log(chalk.yellow('\n  No skills configured.'));
            console.log(chalk.gray(`  Use ${chalk.bold('phaibel skill add <name> --command <cmd>')} to add one.\n`));
            return;
        }

        console.log(chalk.cyan('\n  Configured MCP skills:\n'));
        for (const skill of cfg.skills) {
            console.log(`    ${chalk.bold(skill.name)} ${chalk.gray(`(${skill.id})`)}`);
            console.log(`    ${chalk.gray(`${skill.command} ${skill.args.join(' ')}`)}`);
            const envKeys = Object.keys(skill.env);
            if (envKeys.length > 0) {
                console.log(`    ${chalk.gray(`env: ${envKeys.join(', ')}`)}`);
            }
            console.log('');
        }
    });

export default skillCommand;
