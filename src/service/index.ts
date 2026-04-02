#!/usr/bin/env node

/**
 * Phaibel Service - Background daemon for task processing.
 *
 * This is the main entry point for the service when run as a daemon.
 * It starts the Unix socket server and queue processor.
 */

import { ServiceServer } from './server.js';
import { WebServer, setWebServerInstance } from './web-server.js';
import { getQueueManager } from './queue/manager.js';
import { getQueueProcessor } from './queue/processor.js';
import { SOCKET_PATH } from './daemon.js';
import { getEntityIndex } from '../entities/entity-index.js';
import { getEmbeddingIndex } from '../entities/embedding-index.js';
import { debug } from '../utils/debug.js';
import { getCronScheduler } from './cron/scheduler.js';
import type { ServiceRequest, ServiceResponse, Task } from './protocol.js';

// Only run if this is the service process
const isService = process.env.PHAIBEL_SERVICE === '1';

async function handleRequest(request: ServiceRequest): Promise<ServiceResponse> {
    const queueManager = await getQueueManager();
    const queueProcessor = getQueueProcessor();

    try {
        switch (request.type) {
            case 'task': {
                const task = request.payload as Task;
                const taskId = queueManager.enqueue(task);
                return {
                    requestId: request.id,
                    status: 'queued',
                    result: { taskId },
                };
            }

            case 'query': {
                const payload = request.payload as { query: string; taskId?: string; key?: string };

                switch (payload.query) {
                    case 'queue.size':
                        return {
                            requestId: request.id,
                            status: 'completed',
                            result: { size: queueManager.size() },
                        };

                    case 'queue.status':
                        return {
                            requestId: request.id,
                            status: 'completed',
                            result: queueManager.getFullStatus(),
                        };

                    case 'service.memory': {
                        const mem = process.memoryUsage();
                        return {
                            requestId: request.id,
                            status: 'completed',
                            result: {
                                rss: Math.round(mem.rss / 1024 / 1024),
                                heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
                                heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
                                external: Math.round(mem.external / 1024 / 1024),
                            },
                        };
                    }

                    case 'task.status':
                        const task = queueManager.getTask(payload.taskId!);
                        return {
                            requestId: request.id,
                            status: 'completed',
                            result: task,
                        };

                    case 'index.stats':
                        return {
                            requestId: request.id,
                            status: 'completed',
                            result: getEntityIndex().getStats(),
                        };

                    case 'index.graph':
                        return {
                            requestId: request.id,
                            status: 'completed',
                            result: getEntityIndex().getAllEdges(),
                        };

                    case 'index.neighbors': {
                        const neighbors = getEntityIndex().getNeighbors(payload.key!);
                        return {
                            requestId: request.id,
                            status: 'completed',
                            result: neighbors,
                        };
                    }

                    case 'index.rebuild':
                        await getEntityIndex().rebuild();
                        return {
                            requestId: request.id,
                            status: 'completed',
                            result: getEntityIndex().getStats(),
                        };

                    case 'cron.status':
                        return {
                            requestId: request.id,
                            status: 'completed',
                            result: getCronScheduler().getStatus(),
                        };

                    case 'cron.run': {
                        const jobName = (payload as unknown as { job: string }).job;
                        if (!jobName) {
                            return {
                                requestId: request.id,
                                status: 'error',
                                error: 'Missing job name',
                            };
                        }
                        try {
                            const summary = await getCronScheduler().runJob(jobName);
                            return {
                                requestId: request.id,
                                status: 'completed',
                                result: { job: jobName, summary },
                            };
                        } catch (err) {
                            return {
                                requestId: request.id,
                                status: 'error',
                                error: err instanceof Error ? err.message : String(err),
                            };
                        }
                    }

                    default:
                        return {
                            requestId: request.id,
                            status: 'error',
                            error: `Unknown query: ${payload.query}`,
                        };
                }
            }

            case 'control': {
                const payload = request.payload as { control: string; confirm?: boolean };

                switch (payload.control) {
                    case 'queue.clear':
                        if (!payload.confirm) {
                            return {
                                requestId: request.id,
                                status: 'error',
                                error: 'Confirmation required to clear queue',
                            };
                        }
                        const cleared = queueManager.clear();
                        return {
                            requestId: request.id,
                            status: 'completed',
                            result: { cleared },
                        };

                    case 'queue.pause':
                        queueProcessor.pause();
                        return {
                            requestId: request.id,
                            status: 'completed',
                            result: { paused: true },
                        };

                    case 'queue.resume':
                        queueProcessor.resume();
                        return {
                            requestId: request.id,
                            status: 'completed',
                            result: { paused: false },
                        };

                    default:
                        return {
                            requestId: request.id,
                            status: 'error',
                            error: `Unknown control: ${payload.control}`,
                        };
                }
            }

            default:
                return {
                    requestId: request.id,
                    status: 'error',
                    error: `Unknown request type: ${request.type}`,
                };
        }
    } catch (error) {
        return {
            requestId: request.id,
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

async function main(): Promise<void> {
    console.log('Phaibel service starting...');

    const server = new ServiceServer();
    const webServer = new WebServer();
    setWebServerInstance(webServer);
    const processor = getQueueProcessor();
    const cron = getCronScheduler();

    // Set up request handler
    server.onRequest(handleRequest);

    // Handle shutdown signals
    const shutdown = async () => {
        console.log('Shutting down...');
        cron.stop();
        processor.stop();
        await webServer.stop();
        await server.stop();
        process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    // Start server and processor
    await server.start(SOCKET_PATH);
    await processor.start();

    // Vault-dependent startup — skip gracefully if no vault exists yet.
    // The web server can still serve the HTML client for onboarding.
    try {
        // Start cron scheduler
        try {
            await cron.start();
        } catch (err) {
            debug('service', `Cron scheduler skipped: ${err}`);
        }

        // Build entity index
        try {
            const index = getEntityIndex();
            await index.build();
            const stats = index.getStats();
            console.log(`Entity index: ${stats.nodeCount} nodes, ${stats.edgeCount} edges`);

            // Load and sync embedding index
            try {
                const embeddingIndex = getEmbeddingIndex();
                await embeddingIndex.load();
                const result = await embeddingIndex.sync(index);
                console.log(`Embedding index: ${result.added} added, ${result.updated} updated, ${result.removed} removed`);
            } catch (err) {
                debug('embeddings', `Embedding index sync skipped: ${err}`);
            }
        } catch (err) {
            debug('service', `Entity index skipped: ${err}`);
        }
    } catch (err) {
        console.log('No vault found — skipping vault-dependent startup. Use the web client to set up.');
    }

    // Start web server (always — needed for onboarding)
    try {
        await webServer.start(3737);
        console.log('Web client at http://localhost:3737');
    } catch (err) {
        console.error('Failed to start web server:', err);
    }

    console.log(`Phaibel service running on ${SOCKET_PATH}`);
}

if (isService) {
    main().catch((error) => {
        console.error('Failed to start service:', error);
        process.exit(1);
    });
}

export { handleRequest };
