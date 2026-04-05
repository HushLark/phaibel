#!/usr/bin/env node

// Import service module — its own `if (PHAIBEL_SERVICE)` guard starts
// the daemon when re-spawned with that env var.
import './service/index.js';

import { Command } from 'commander';
import chalk from 'chalk';
import { configCommand } from './commands/config.js';
import { syncCommand } from './commands/sync.js';
import { initCommand } from './commands/init.js';
import { serviceCommand, queueCommand, indexCommand } from './commands/service.js';
import { feralCommand } from './commands/feral.js';
import { setupCommand } from './commands/setup.js';
import { cronCommand } from './commands/cron.js';
import { calCommand } from './commands/cal.js';
import { skillCommand } from './commands/skill.js';
import { agentCommand } from './commands/agent.js';
import { entityTypeCommand } from './commands/entity-type.js';
import { entityCommand } from './commands/entity.js';
import { timeCommand } from './commands/time.js';
import { listServiceTools, getServiceTool } from './tools/index.js';
import { bootstrapFeral } from './feral/bootstrap.js';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pkg = require('../package.json');

export const program = new Command();

program
  .name('phaibel')
  .description(chalk.cyan('🤖 Phaibel - Your AI personal assistant'))
  .version(pkg.version);

// Register admin/tool commands
program.addCommand(initCommand);
program.addCommand(configCommand);
program.addCommand(syncCommand);
program.addCommand(serviceCommand);
program.addCommand(queueCommand);
program.addCommand(indexCommand);
program.addCommand(feralCommand);
program.addCommand(timeCommand);
program.addCommand(setupCommand);
program.addCommand(entityTypeCommand);
program.addCommand(entityCommand);
program.addCommand(cronCommand);
program.addCommand(calCommand);
program.addCommand(skillCommand);
program.addCommand(agentCommand);

// Tool command - run any registered tool
program
  .command('tool <name> [input]')
  .description('Run a tool')
  .action(async (name: string, input?: string) => {
    const feral = await bootstrapFeral();
    const tool = feral.toolRegistry.getTool(name) ?? getServiceTool(name);

    if (!tool) {
      console.log(chalk.red(`Unknown tool: ${name}`));
      console.log(chalk.gray('\nAvailable tools:'));
      const allTools = [...feral.toolRegistry.listTools(), ...listServiceTools()];
      const seen = new Set<string>();
      for (const t of allTools) {
        if (seen.has(t.name)) continue;
        seen.add(t.name);
        console.log(chalk.gray(`  - ${t.name}: ${t.description}`));
      }
      return;
    }

    console.log(chalk.gray(`Running ${tool.name}...`));

    const logger = {
      debug: (msg: string) => console.log(chalk.gray(`  [debug] ${msg}`)),
      info: (msg: string) => console.log(chalk.gray(`  [info]  ${msg}`)),
      warn: (msg: string) => console.log(chalk.yellow(`  [warn]  ${msg}`)),
      error: (msg: string) => console.log(chalk.red(`  [error] ${msg}`)),
    };
    const noopLlm = { chat: async () => '(LLM not available in direct CLI mode)' };
    const parsedInput = input ? JSON.parse(input) : {};

    try {
      const result = await tool.execute(parsedInput, {
        taskId: 'cli-direct',
        stepId: 'cli-direct',
        ctx: {} as any,
        previousOutputs: [],
        log: logger,
        llm: noopLlm as any,
      });
      if (result.success) {
        console.log(chalk.green('\n  ✓ Success'));
        if (result.output) {
          console.log(chalk.white(`  ${typeof result.output === 'string' ? result.output : JSON.stringify(result.output, null, 2)}`));
        }
      } else {
        console.log(chalk.red(`\n  ✗ ${result.error || 'Unknown error'}`));
      }
    } catch (err) {
      console.log(chalk.red(`\n  ✗ ${err instanceof Error ? err.message : err}`));
    }
  });

// Tools list command
program
  .command('tools')
  .description('List available tools')
  .action(async () => {
    const feral = await bootstrapFeral();
    const allTools = [...feral.toolRegistry.listTools(), ...listServiceTools()];
    const seen = new Set<string>();

    console.log(chalk.cyan('\n🔧 Available Tools:\n'));
    for (const tool of allTools) {
      if (seen.has(tool.name)) continue;
      seen.add(tool.name);
      const typeIcon = tool.type === 'deterministic' ? '⚡' : '🤖';
      console.log(`  ${typeIcon} ${chalk.bold(tool.name)}`);
      console.log(chalk.gray(`     ${tool.description}`));
      console.log('');
    }
  });

// Custom help — grouped and useful
program.configureHelp({
  formatHelp: () => {
    const v = pkg.version;
    return `
${chalk.cyan('🤖 Phaibel')} ${chalk.dim(`v${v}`)} ${chalk.dim('— AI personal assistant')}

${chalk.cyan('Getting Started')}
  ${chalk.bold('phaibel init')}                Create a new vault, configure API key, start service
  ${chalk.bold('phaibel service start')}       Start the background service + web client
  ${chalk.dim('  Then open')} ${chalk.cyan.bold('http://localhost:3737')} ${chalk.dim('to chat with your agent')}

${chalk.cyan('Configuration')}
  ${chalk.bold('phaibel config')}              Manage API keys and LLM provider settings
  ${chalk.bold('phaibel setup')}               Update your name, gender, and preferences
  ${chalk.bold('phaibel calendar add')} ${chalk.dim('<name> <ics-url>')}  Add a Google Calendar ICS feed
  ${chalk.bold('phaibel calendar sync')}       Sync calendar events into the vault
  ${chalk.bold('phaibel skill')}               Manage MCP skill servers

${chalk.cyan('Service & Monitoring')}
  ${chalk.bold('phaibel service')} ${chalk.dim('start|stop|restart|status')}  Manage the daemon
  ${chalk.bold('phaibel queue')} ${chalk.dim('status|pause|resume|clear')}    Inspect the task queue
  ${chalk.bold('phaibel cron')} ${chalk.dim('list|enable|disable|run')}       Manage scheduled jobs
  ${chalk.bold('phaibel index')} ${chalk.dim('stats|rebuild|graph')}          Entity relationship graph

${chalk.cyan('Data')}
  ${chalk.bold('phaibel entity')} ${chalk.dim('<type> [action] [title]')}   CRUD for any entity type
  ${chalk.bold('phaibel type')} ${chalk.dim('list|add|edit|remove')}         Manage entity type schemas
  ${chalk.bold('phaibel sync')}                Git-based vault sync

${chalk.cyan('Advanced')}
  ${chalk.bold('phaibel feral')}               Inspect the flow-based processing engine
  ${chalk.bold('phaibel tool')} ${chalk.dim('<name> [json]')}     Run a registered tool directly
  ${chalk.bold('phaibel tools')}               List all available tools
  ${chalk.bold('phaibel time')}                Show current local time

${chalk.dim('Run')} ${chalk.bold('phaibel <command> --help')} ${chalk.dim('for details on any command.')}
`;
  },
});

// Default: show help
program
  .action(() => {
    program.help();
  });

// In service daemon mode, service/index.ts already started the server —
// skip Commander parsing so we don't print help text.
if (process.env.PHAIBEL_SERVICE !== '1') {
  program.parse();
}
