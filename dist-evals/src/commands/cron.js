// ─────────────────────────────────────────────────────────────────────────────
// CRON COMMAND
// Manage periodic background jobs in the service daemon.
// ─────────────────────────────────────────────────────────────────────────────
import { Command } from 'commander';
import chalk from 'chalk';
import { loadCronConfig, saveCronConfig } from '../service/cron/scheduler.js';
import { getServiceClient } from '../client/index.js';
const VALID_JOBS = [
    'cal-sync', 'inbox-import', 'recurrence-generate',
    'pamp-check', 'embedding-sync',
];
function assertValidJob(name) {
    if (!VALID_JOBS.includes(name)) {
        console.log(chalk.red(`\n  Unknown job: "${name}"`));
        console.log(chalk.gray(`  Valid jobs: ${VALID_JOBS.join(', ')}\n`));
        process.exit(1);
    }
}
export const cronCommand = new Command('cron')
    .description('Manage periodic background jobs');
// ── list ────────────────────────────────────────────────────────────────────
cronCommand
    .command('list')
    .description('Show all cron jobs with their configuration')
    .action(async () => {
    const config = await loadCronConfig();
    console.log(chalk.cyan('\n  Cron Jobs:\n'));
    for (const [name, job] of Object.entries(config.jobs)) {
        const status = job.enabled
            ? chalk.green('enabled')
            : chalk.gray('disabled');
        const interval = job.intervalMinutes >= 60
            ? `${job.intervalMinutes / 60}h`
            : `${job.intervalMinutes}m`;
        console.log(`  ${chalk.bold(name.padEnd(24))} ${status}  every ${interval}`);
    }
    console.log('');
});
// ── enable ──────────────────────────────────────────────────────────────────
cronCommand
    .command('enable <job>')
    .description('Enable a cron job')
    .action(async (job) => {
    assertValidJob(job);
    const config = await loadCronConfig();
    config.jobs[job].enabled = true;
    await saveCronConfig(config);
    console.log(chalk.green(`\n  Enabled "${job}". Restart the service for changes to take effect.\n`));
});
// ── disable ─────────────────────────────────────────────────────────────────
cronCommand
    .command('disable <job>')
    .description('Disable a cron job')
    .action(async (job) => {
    assertValidJob(job);
    const config = await loadCronConfig();
    config.jobs[job].enabled = false;
    await saveCronConfig(config);
    console.log(chalk.green(`\n  Disabled "${job}". Restart the service for changes to take effect.\n`));
});
// ── set-interval ────────────────────────────────────────────────────────────
cronCommand
    .command('set-interval <job> <minutes>')
    .description('Set the interval in minutes for a cron job')
    .action(async (job, minutes) => {
    assertValidJob(job);
    const mins = parseInt(minutes, 10);
    if (isNaN(mins) || mins < 1) {
        console.log(chalk.red('\n  Interval must be a positive number of minutes.\n'));
        return;
    }
    const config = await loadCronConfig();
    config.jobs[job].intervalMinutes = mins;
    await saveCronConfig(config);
    console.log(chalk.green(`\n  Set "${job}" interval to ${mins} minutes. Restart the service for changes to take effect.\n`));
});
// ── status ──────────────────────────────────────────────────────────────────
cronCommand
    .command('status')
    .description('Show live cron status from running service')
    .action(async () => {
    const client = getServiceClient();
    try {
        await client.connect();
        const status = await client.getCronStatus();
        client.disconnect();
        console.log(chalk.cyan('\n  Cron Status (live):\n'));
        for (const job of status.jobs) {
            const enabledStr = job.enabled
                ? chalk.green('enabled')
                : chalk.gray('disabled');
            const runningStr = job.running
                ? chalk.yellow(' [running]')
                : '';
            const interval = job.intervalMinutes >= 60
                ? `${job.intervalMinutes / 60}h`
                : `${job.intervalMinutes}m`;
            console.log(`  ${chalk.bold(job.name.padEnd(24))} ${enabledStr}  every ${interval}${runningStr}`);
            if (job.lastRunAt) {
                const ago = timeSince(new Date(job.lastRunAt));
                console.log(chalk.gray(`    Last run: ${ago} ago — ${job.lastResult ?? 'no result'}`));
            }
            if (job.lastError) {
                console.log(chalk.red(`    Last error: ${job.lastError}`));
            }
            if (job.nextRunAt) {
                const until = timeUntil(new Date(job.nextRunAt));
                console.log(chalk.gray(`    Next run: in ${until}`));
            }
        }
        console.log('');
    }
    catch (err) {
        console.log(chalk.red(`\n  ${err instanceof Error ? err.message : err}`));
        console.log(chalk.gray('  Is the service running? Try "phaibel service start".\n'));
    }
});
// ── run ─────────────────────────────────────────────────────────────────────
cronCommand
    .command('run <job>')
    .description('Trigger a cron job immediately via the service')
    .action(async (job) => {
    assertValidJob(job);
    const client = getServiceClient();
    try {
        await client.connect();
        console.log(chalk.gray(`\n  Running "${job}"...`));
        const result = await client.runCronJob(job);
        client.disconnect();
        console.log(chalk.green(`  Done: ${result.summary}\n`));
    }
    catch (err) {
        console.log(chalk.red(`\n  ${err instanceof Error ? err.message : err}`));
        console.log(chalk.gray('  Is the service running? Try "phaibel service start".\n'));
    }
});
// ── helpers ─────────────────────────────────────────────────────────────────
function timeSince(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60)
        return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
        return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return `${hours}h ${minutes % 60}m`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
}
function timeUntil(date) {
    const seconds = Math.floor((date.getTime() - Date.now()) / 1000);
    if (seconds < 0)
        return 'now';
    if (seconds < 60)
        return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
        return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
}
export default cronCommand;
