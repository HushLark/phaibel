// ─────────────────────────────────────────────────────────────────────────────
// SKILL COMMAND
// ─────────────────────────────────────────────────────────────────────────────
// Manage Phaibel skills (agentskills.io-compatible directories) and legacy
// MCP skill servers (under `skill mcp`).
// ─────────────────────────────────────────────────────────────────────────────
import { Command } from 'commander';
import chalk from 'chalk';
import { loadSkillMetas, loadSkillManifest, createSkill } from '../skills/skill-manager.js';
import { loadSkillsConfig, saveSkillsConfig } from '../skills/skill-config.js';
export const skillCommand = new Command('skill')
    .description('Manage skills and MCP skill servers');
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
    .action(async (name) => {
    const metas = await loadSkillMetas();
    const meta = metas.find(m => m.name === name);
    if (!meta) {
        console.log(chalk.yellow(`\n  No skill found with name "${name}", sir.\n`));
        return;
    }
    const manifest = await loadSkillManifest(meta);
    console.log(chalk.cyan(`\n  ${manifest.name}`));
    console.log(chalk.gray(`  ${manifest.description}`));
    if (manifest.tags.length > 0)
        console.log(`  tags: ${manifest.tags.join(', ')}`);
    if (manifest.triggers.length > 0)
        console.log(`  triggers: ${manifest.triggers.join(', ')}`);
    if (manifest.scriptNames.length > 0)
        console.log(`  scripts: ${manifest.scriptNames.join(', ')}`);
    console.log('');
    console.log(manifest.body);
    console.log('');
});
// ── create ───────────────────────────────────────────────────────────────────
skillCommand
    .command('create <name>')
    .description('Scaffold a new skill directory')
    .option('--description <desc>', 'Skill description', '')
    .action(async (name, opts) => {
    const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const dir = await createSkill(safeName, opts.description || `${name} skill`);
    console.log(chalk.green(`\n  Skill "${safeName}" created at ${dir}`));
    console.log(chalk.gray(`  Edit SKILL.md and add Feral process JSON files to scripts/\n`));
});
// ── mcp (legacy MCP skill server management) ─────────────────────────────────
const mcpCommand = skillCommand
    .command('mcp')
    .description('Manage MCP skill servers (legacy)');
mcpCommand
    .command('add <name>')
    .description('Add an MCP skill server')
    .requiredOption('--command <cmd>', 'Command to spawn the MCP server')
    .option('--args <args...>', 'Arguments for the command')
    .option('--env <pairs...>', 'Environment variables as KEY=VAL pairs')
    .action(async (name, opts) => {
    const cfg = await loadSkillsConfig();
    const id = name.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    if (cfg.skills.some(s => s.id === id)) {
        console.log(chalk.yellow(`\n  A skill with id "${id}" already exists, sir.`));
        console.log(chalk.gray(`  Use ${chalk.bold(`phaibel skill mcp remove ${id}`)} first, then re-add.\n`));
        return;
    }
    const env = {};
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
    console.log(chalk.green(`\n  MCP skill "${name}" (${id}) added, sir.\n`));
});
mcpCommand
    .command('remove <name>')
    .description('Remove an MCP skill server')
    .action(async (name) => {
    const cfg = await loadSkillsConfig();
    const idx = cfg.skills.findIndex(s => s.id === name || s.name === name);
    if (idx === -1) {
        console.log(chalk.yellow(`\n  No MCP skill found with id or name "${name}", sir.\n`));
        return;
    }
    const removed = cfg.skills.splice(idx, 1)[0];
    await saveSkillsConfig(cfg);
    console.log(chalk.green(`\n  MCP skill "${removed.name}" (${removed.id}) removed, sir.\n`));
});
mcpCommand
    .command('list')
    .description('Show all configured MCP skill servers')
    .action(async () => {
    const cfg = await loadSkillsConfig();
    if (cfg.skills.length === 0) {
        console.log(chalk.yellow('\n  No MCP skills configured.'));
        console.log(chalk.gray(`  Use ${chalk.bold('phaibel skill mcp add <name> --command <cmd>')} to add one.\n`));
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
