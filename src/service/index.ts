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

// Create a Foundation (root .cxms.md + base directories) at PHAIBEL_VAULT if one
// doesn't exist yet — so a freshly-created per-account vault is usable on first
// boot without requiring `phaibel init` or the web setup wizard.
async function ensureFoundation(): Promise<void> {
    const vault = process.env.PHAIBEL_VAULT;
    if (!vault) return;
    const { promises: fs } = await import('fs');
    const path = (await import('path')).default;
    const marker = path.join(vault, '.cxms.md');
    try {
        await fs.access(marker);
        return; // already a foundation
    } catch { /* needs init */ }
    try {
        await fs.mkdir(vault, { recursive: true });
        const today = new Date().toISOString().split('T')[0];
        const name = path.basename(vault);
        await fs.writeFile(marker, `---
title: "${name}"
created: ${today}
---

# ${name}

## Memory

This Foundation is the agent's memory. Content is stored as Markdown files with
YAML frontmatter, organised by context type (tasks, events, notes, goals, people,
places, etc.) and linked into a knowledge graph.

## User Preferences

- Timezone: Local machine time
- Date format: YYYY-MM-DD
`);
        const { initEntityTypes } = await import('../entities/entity-type-config.js');
        await initEntityTypes(); // creates context-types/ + each built-in type dir
        console.log(`[boot] Initialized new foundation at ${vault}`);
    } catch (err) {
        console.warn(`[boot] Foundation init failed: ${err instanceof Error ? err.message : err}`);
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
    await server.start(SOCKET_PATH());
    await processor.start();

    // Start the web server FIRST — before the (potentially slow) entity-index and
    // embedding build below. Clients (Phaibel Desktop) wait on this port to open
    // their window; gating it behind a fresh-vault embedding-model init made the
    // app fail with "daemon did not start in time". Port is overridable via
    // PHAIBEL_PORT so the CLI and Phaibel Desktop daemons don't collide on 3737.
    const webPort = Number(process.env.PHAIBEL_PORT) || 3737;
    try {
        await webServer.start(webPort);
        console.log(`Web client at http://localhost:${webPort}`);
        console.log(`  Mobile:    http://localhost:${webPort}/mobile`);
        console.log(`  Productve: http://localhost:${webPort}/productve`);
        console.log(`  Assistant: http://localhost:${webPort}/assistant`);
    } catch (err) {
        console.error('Failed to start web server:', err);
    }
    webServer.setBootPhase('indexing');

    // Yield a tick so the just-bound web server can serve /api/status before the
    // index build below runs. Lets the desktop onboarding show real progress.
    await new Promise((r) => setImmediate(r));

    // Ensure the configured vault is a valid Foundation. Phaibel Desktop points
    // PHAIBEL_VAULT at a fresh per-account dir (~/.phaibel/vaults/<slug>) that
    // has no .cxms.md yet; without this, every vault op fails ("No foundation").
    await ensureFoundation();

    // Vault-dependent startup — skip gracefully if no vault exists yet.
    // The web server can still serve the HTML client for onboarding.
    try {
        // Start cron scheduler
        try {
            await cron.start();
        } catch (err) {
            debug('service', `Cron scheduler skipped: ${err}`);
        }

        // Build entity index (async file I/O — yields, doesn't block the loop).
        // Guarded by a timeout so a stuck build can't pin the daemon in 'indexing'
        // forever; the boot markers below pinpoint where a stall happens.
        try {
            console.log('[boot] Building entity index…');
            const index = getEntityIndex();
            await Promise.race([
                index.build(),
                new Promise((_, rej) => setTimeout(() => rej(new Error('entity index build timed out after 25s')), 25_000)),
            ]);
            const stats = index.getStats();
            console.log(`Entity index: ${stats.nodeCount} nodes, ${stats.edgeCount} edges`);
        } catch (err) {
            console.warn(`[boot] Entity index skipped: ${err instanceof Error ? err.message : err}`);
        }
    } catch (err) {
        console.log('No vault found — skipping vault-dependent startup. Use the web client to set up.');
    }

    // The daemon is functionally ready once the entity index is built (chat,
    // browse, onboarding all work). Mark ready BEFORE the embedding/behavioral
    // load, which uses onnxruntime and can block the single-threaded event loop —
    // gating readiness on it made onboarding stall on a fresh vault.
    webServer.setBootPhase('ready');
    console.log(`Phaibel service running on ${SOCKET_PATH()}`);

    // Defer the heavy embedding + behavioral sync so it runs AFTER the daemon is
    // serving requests. Fire-and-forget: even if onnxruntime is slow/hangs on
    // first run, the app is already usable. The cron 'embedding-sync' job keeps
    // it current thereafter.
    setImmediate(async () => {
        try {
            const index = getEntityIndex();
            const embeddingIndex = getEmbeddingIndex();
            await embeddingIndex.load();
            const result = await embeddingIndex.sync(index);
            console.log(`Embedding index: ${result.added} added, ${result.updated} updated, ${result.removed} removed`);
        } catch (err) {
            debug('embeddings', `Embedding index sync skipped: ${err}`);
        }
        try {
            const { getBehavioralIndex } = await import('../cxms/behavioral-index.js');
            await getBehavioralIndex().load();
            debug('service', 'Behavioral index loaded');
        } catch (err) {
            debug('service', `Behavioral index load skipped: ${err}`);
        }
    });
}

if (isService) {
    main().catch((error) => {
        console.error('Failed to start service:', error);
        process.exit(1);
    });
}

export { handleRequest };
