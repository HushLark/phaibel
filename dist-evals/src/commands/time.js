import { Command } from 'commander';
import chalk from 'chalk';
import { bootstrapFeral } from '../feral/bootstrap.js';
export const timeCommand = new Command('time')
    .description('Show the current local time')
    .action(async () => {
    const feral = await bootstrapFeral();
    const ctx = await feral.runner.run('system.time');
    const time = ctx.getString('current_time');
    console.log(chalk.cyan(`\n  🕐 ${time}\n`));
});
