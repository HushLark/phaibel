import { Command } from 'commander';
import chalk from 'chalk';
import { startDaemon, stopDaemon, getDaemonStatus } from '../service/daemon.js';
import { getServiceClient } from '../client/index.js';
import { getResponse } from '../responses.js';

/**
 * Service management commands.
 */
export const serviceCommand = new Command('service')
    .description('Manage the Phaibel background service');

// phaibelservice start
serviceCommand
    .command('start')
    .description('Start the Phaibel background service')
    .action(async () => {
        console.log(chalk.cyan('Starting Phaibel service...'));

        try {
            const status = await startDaemon();

            if (status.running) {
                console.log(chalk.green('✓ Phaibel service is running'));
                console.log(chalk.dim(`  PID: ${status.pid}`));
                console.log(chalk.dim(`  Socket: ${status.socketPath}`));
                console.log(chalk.dim(`  Web: http://localhost:3737`));
            } else {
                console.log(chalk.red('✗ Failed to start service'));
            }
        } catch (error) {
            console.error(chalk.red(getResponse('error')), error);
        }
        process.exit(0);
    });

// phaibelservice stop
serviceCommand
    .command('stop')
    .description('Stop the Phaibel background service')
    .action(async () => {
        console.log(chalk.cyan('Stopping Phaibel service...'));

        try {
            const status = await stopDaemon();

            if (!status.running) {
                console.log(chalk.green('✓ Phaibel service stopped'));
            } else {
                console.log(chalk.red('✗ Failed to stop service'));
            }
        } catch (error) {
            console.error(chalk.red(getResponse('error')), error);
        }
        process.exit(0);
    });

// phaibelservice restart
serviceCommand
    .command('restart')
    .description('Restart the Phaibel background service')
    .action(async () => {
        try {
            const status = await getDaemonStatus();

            if (status.running) {
                console.log(chalk.cyan('Stopping Phaibel service...'));
                await stopDaemon();
                console.log(chalk.green('✓ Stopped'));
            }

            console.log(chalk.cyan('Starting Phaibel service...'));
            const newStatus = await startDaemon();

            if (newStatus.running) {
                console.log(chalk.green('✓ Phaibel service is running'));
                console.log(chalk.dim(`  PID: ${newStatus.pid}`));
                console.log(chalk.dim(`  Socket: ${newStatus.socketPath}`));
                console.log(chalk.dim(`  Web: http://localhost:3737`));
            } else {
                console.log(chalk.red('✗ Failed to start service'));
            }
        } catch (error) {
            console.error(chalk.red(getResponse('error')), error);
        }
        process.exit(0);
    });

// phaibelservice status
serviceCommand
    .command('status')
    .description('Check the status of the Phaibel service')
    .action(async () => {
        try {
            const status = await getDaemonStatus();

            if (status.running) {
                console.log(chalk.green('✓ Phaibel service is running'));
                console.log(chalk.dim(`  PID: ${status.pid}`));
                console.log(chalk.dim(`  Socket: ${status.socketPath}`));

                // Show memory usage
                try {
                    const client = getServiceClient();
                    await client.connect();
                    const mem = await client.getMemoryUsage();
                    console.log(chalk.dim(`  Memory: ${mem.rss}MB RSS (heap: ${mem.heapUsed}/${mem.heapTotal}MB)`));

                    const queueStatus = await client.getQueueStatus();
                    const queue = queueStatus.result as {
                        size: number; maxSize: number; processing: number;
                        pending: number; completedCount: number; errorCount: number;
                    };
                    console.log(chalk.dim(`  Queue: ${queue.size}/${queue.maxSize} (${queue.processing} processing, ${queue.pending} pending)`));

                    client.disconnect();
                } catch {
                    // Service running but can't connect — skip details
                }
            } else {
                console.log(chalk.yellow('○ Phaibel service is not running'));
                console.log(chalk.dim('  Start with: phaibel service start'));
            }
        } catch (error) {
            console.error(chalk.red(getResponse('error')), error);
        }
    });

/**
 * Queue management commands.
 */
export const queueCommand = new Command('queue')
    .description('Manage the task queue');

// phaibelqueue size
queueCommand
    .command('size')
    .description('Get the current queue size')
    .action(async () => {
        try {
            const client = getServiceClient();
            await client.connect();

            const size = await client.getQueueSize();
            console.log(chalk.cyan(`Queue size: ${size}`));

            client.disconnect();
        } catch (error) {
            console.error(chalk.red(getResponse('error')), error instanceof Error ? error.message : error);
        }
    });

// phaibelqueue status
queueCommand
    .command('status')
    .description('Get detailed queue status')
    .action(async () => {
        try {
            const client = getServiceClient();
            await client.connect();

            const response = await client.getQueueStatus();
            const status = response.result as {
                size: number;
                maxSize: number;
                isFull: boolean;
                processing: number;
                pending: number;
                completedCount: number;
                errorCount: number;
            };

            console.log(chalk.cyan('Queue Status:'));
            console.log(`  Size: ${status.size}/${status.maxSize}${status.isFull ? chalk.red(' (FULL)') : ''}`);
            console.log(`  Processing: ${status.processing}`);
            console.log(`  Pending: ${status.pending}`);
            console.log(`  Completed: ${chalk.green(status.completedCount.toString())}`);
            console.log(`  Errors: ${status.errorCount > 0 ? chalk.red(status.errorCount.toString()) : '0'}`);

            client.disconnect();
        } catch (error) {
            console.error(chalk.red(getResponse('error')), error instanceof Error ? error.message : error);
        }
    });

// phaibelqueue clear
queueCommand
    .command('clear')
    .description('Clear all pending tasks from the queue')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (options) => {
        if (!options.yes) {
            console.log(chalk.yellow('Use --yes to confirm clearing the queue'));
            return;
        }

        try {
            const client = getServiceClient();
            await client.connect();

            const response = await client.clearQueue();
            const cleared = (response.result as { cleared: number }).cleared;

            console.log(chalk.green(`✓ Cleared ${cleared} tasks from queue`));

            client.disconnect();
        } catch (error) {
            console.error(chalk.red(getResponse('error')), error instanceof Error ? error.message : error);
        }
    });

// phaibelqueue pause
queueCommand
    .command('pause')
    .description('Pause queue processing')
    .action(async () => {
        try {
            const client = getServiceClient();
            await client.connect();

            await client.pauseQueue();
            console.log(chalk.yellow('⏸ Queue processing paused'));

            client.disconnect();
        } catch (error) {
            console.error(chalk.red(getResponse('error')), error instanceof Error ? error.message : error);
        }
    });

// phaibelqueue resume
queueCommand
    .command('resume')
    .description('Resume queue processing')
    .action(async () => {
        try {
            const client = getServiceClient();
            await client.connect();

            await client.resumeQueue();
            console.log(chalk.green('▶ Queue processing resumed'));

            client.disconnect();
        } catch (error) {
            console.error(chalk.red(getResponse('error')), error instanceof Error ? error.message : error);
        }
    });

/**
 * Entity index commands.
 */
export const indexCommand = new Command('index')
    .description('Manage the entity index and relationship graph');

// phaibelindex stats
indexCommand
    .command('stats')
    .description('Show entity index statistics')
    .action(async () => {
        try {
            const client = getServiceClient();
            await client.connect();

            const stats = await client.getIndexStats();
            console.log(chalk.cyan('Entity Index:'));
            console.log(`  Nodes: ${chalk.white(stats.nodeCount.toString())}`);
            console.log(`  Edges: ${chalk.white(stats.edgeCount.toString())}`);
            console.log(`  Built: ${chalk.dim(stats.builtAt)}`);

            if (Object.keys(stats.byType).length > 0) {
                console.log(chalk.dim('  By type:'));
                for (const [type, count] of Object.entries(stats.byType)) {
                    console.log(`    ${type}: ${count}`);
                }
            }

            client.disconnect();
        } catch (error) {
            console.error(chalk.red(getResponse('error')), error instanceof Error ? error.message : error);
        }
    });

// phaibelindex graph
indexCommand
    .command('graph')
    .description('Show all entity relationships')
    .action(async () => {
        try {
            const client = getServiceClient();
            await client.connect();

            const edges = await client.getIndexGraph();

            if (edges.length === 0) {
                console.log(chalk.gray('No relationships found.'));
            } else {
                console.log(chalk.cyan(`Entity Graph (${edges.length} edges):\n`));
                for (const edge of edges) {
                    const arrow = edge.edgeType === 'mention' ? chalk.magenta('@→') : chalk.blue('→');
                    console.log(`  ${chalk.white(edge.source)} ${arrow} ${chalk.white(edge.target)}`);
                }
            }

            client.disconnect();
        } catch (error) {
            console.error(chalk.red(getResponse('error')), error instanceof Error ? error.message : error);
        }
    });

// phaibelindex neighbors <key>
indexCommand
    .command('neighbors <key>')
    .description('Show neighbors of an entity (e.g. "note:my-note" or "person:gary-clift")')
    .action(async (key: string) => {
        try {
            const client = getServiceClient();
            await client.connect();

            const neighbors = await client.getIndexNeighbors(key);

            if (neighbors.length === 0) {
                console.log(chalk.gray(`No neighbors found for ${key}.`));
            } else {
                console.log(chalk.cyan(`Neighbors of ${chalk.white(key)}:\n`));
                for (const n of neighbors) {
                    const arrow = n.direction === 'out' ? '→' : '←';
                    const edgeIcon = n.edgeType === 'mention' ? chalk.magenta('@') : chalk.blue('⟿');
                    console.log(`  ${arrow} ${edgeIcon} ${chalk.white(`${n.node.type}:${n.node.id}`)} — ${n.node.title}`);
                }
            }

            client.disconnect();
        } catch (error) {
            console.error(chalk.red(getResponse('error')), error instanceof Error ? error.message : error);
        }
    });

// phaibelindex rebuild
indexCommand
    .command('rebuild')
    .description('Rebuild the entity index')
    .action(async () => {
        try {
            const client = getServiceClient();
            await client.connect();

            console.log(chalk.cyan('Rebuilding entity index...'));
            const stats = await client.rebuildIndex();

            console.log(chalk.green(`✓ Index rebuilt: ${stats.nodeCount} nodes, ${stats.edgeCount} edges`));

            client.disconnect();
        } catch (error) {
            console.error(chalk.red(getResponse('error')), error instanceof Error ? error.message : error);
        }
    });
