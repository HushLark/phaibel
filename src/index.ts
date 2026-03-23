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
import { skillCommand } from './commands/skill.js';
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
program.addCommand(skillCommand);

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

// Default: show help (no more interactive shell)
program
  .action(() => {
    program.help();
  });

// In service daemon mode, service/index.ts already started the server —
// skip Commander parsing so we don't print help text.
if (process.env.PHAIBEL_SERVICE !== '1') {
  program.parse();
}
