// ─────────────────────────────────────────────────────────────────────────────
// AGENT COMMAND
// ─────────────────────────────────────────────────────────────────────────────
// Manage A2A agent connections — add, remove, list, ping.
// ─────────────────────────────────────────────────────────────────────────────
import { Command } from 'commander';
import chalk from 'chalk';
import { loadAgentsConfig, saveAgentsConfig } from '../agents/agent-config.js';
export const agentCommand = new Command('agent')
    .description('Manage A2A agent connections');
// ── add ──────────────────────────────────────────────────────────────────────
agentCommand
    .command('add <name>')
    .description('Add an A2A agent')
    .requiredOption('--url <url>', 'Base URL of the A2A agent (e.g. http://localhost:4000)')
    .option('--description <desc>', 'Human-readable description of the agent')
    .option('--headers <pairs...>', 'Custom headers as KEY=VAL pairs (e.g. Authorization="Bearer token")')
    .action(async (name, opts) => {
    const cfg = await loadAgentsConfig();
    const id = name.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    if (cfg.agents.some(a => a.id === id)) {
        console.log(chalk.yellow(`\n  An agent with id "${id}" already exists, sir.`));
        console.log(chalk.gray(`  Use ${chalk.bold(`phaibel agent remove ${id}`)} first, then re-add.\n`));
        return;
    }
    const headers = {};
    if (opts.headers) {
        for (const pair of opts.headers) {
            const eqIdx = pair.indexOf('=');
            if (eqIdx > 0) {
                headers[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
            }
        }
    }
    cfg.agents.push({
        id,
        name,
        url: opts.url.replace(/\/$/, ''),
        description: opts.description,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
    });
    await saveAgentsConfig(cfg);
    console.log(chalk.green(`\n  Agent "${name}" (${id}) added at ${opts.url}`));
    console.log(chalk.gray(`  It will be available next time the agent starts.\n`));
});
// ── remove ───────────────────────────────────────────────────────────────────
agentCommand
    .command('remove <name>')
    .description('Remove an A2A agent')
    .action(async (name) => {
    const cfg = await loadAgentsConfig();
    const idx = cfg.agents.findIndex(a => a.id === name || a.name === name);
    if (idx === -1) {
        console.log(chalk.yellow(`\n  No agent found with id or name "${name}", sir.\n`));
        return;
    }
    const removed = cfg.agents.splice(idx, 1)[0];
    await saveAgentsConfig(cfg);
    console.log(chalk.green(`\n  Agent "${removed.name}" (${removed.id}) removed, sir.\n`));
});
// ── list ─────────────────────────────────────────────────────────────────────
agentCommand
    .command('list')
    .description('Show all configured A2A agents')
    .action(async () => {
    const cfg = await loadAgentsConfig();
    if (cfg.agents.length === 0) {
        console.log(chalk.yellow('\n  No agents configured.'));
        console.log(chalk.gray(`  Use ${chalk.bold('phaibel agent add <name> --url <url>')} to add one.\n`));
        return;
    }
    console.log(chalk.cyan('\n  Configured A2A agents:\n'));
    for (const agent of cfg.agents) {
        console.log(`    ${chalk.bold(agent.name)} ${chalk.gray(`(${agent.id})`)}`);
        console.log(`    ${chalk.gray(agent.url)}`);
        if (agent.description) {
            console.log(`    ${chalk.gray(agent.description)}`);
        }
        if (agent.headers && Object.keys(agent.headers).length > 0) {
            console.log(`    ${chalk.gray(`headers: ${Object.keys(agent.headers).join(', ')}`)}`);
        }
        console.log('');
    }
});
// ── ping ─────────────────────────────────────────────────────────────────────
agentCommand
    .command('ping [name]')
    .description('Ping an A2A agent (or all) to check connectivity and discover skills')
    .action(async (name) => {
    const cfg = await loadAgentsConfig();
    if (cfg.agents.length === 0) {
        console.log(chalk.yellow('\n  No agents configured.\n'));
        return;
    }
    const targets = name
        ? cfg.agents.filter(a => a.id === name || a.name === name)
        : cfg.agents;
    if (targets.length === 0) {
        console.log(chalk.yellow(`\n  No agent found with id or name "${name}", sir.\n`));
        return;
    }
    console.log(chalk.cyan('\n  Pinging A2A agents...\n'));
    for (const agent of targets) {
        try {
            const url = agent.url + '/.well-known/agent.json';
            const response = await fetch(url, { headers: agent.headers });
            if (!response.ok) {
                console.log(`    ${chalk.red('✗')} ${chalk.bold(agent.name)} — ${response.status} ${response.statusText}`);
                continue;
            }
            const card = await response.json();
            const skillCount = card.skills?.length ?? 0;
            console.log(`    ${chalk.green('✓')} ${chalk.bold(card.name)} — ${skillCount} skill${skillCount !== 1 ? 's' : ''}`);
            if (card.skills) {
                for (const skill of card.skills) {
                    console.log(`      ${chalk.gray(`- ${skill.name} (${skill.id})`)}`);
                }
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.log(`    ${chalk.red('✗')} ${chalk.bold(agent.name)} — ${msg}`);
        }
    }
    console.log('');
});
export default agentCommand;
