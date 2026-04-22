/**
 * Background status poller for the Phaibel shell.
 *
 * Polls service status and queue size on a timer
 * and updates the StatusBar data.
 */
import { getDaemonStatus } from '../service/daemon.js';
import { getServiceClient } from '../client/index.js';
const POLL_INTERVAL_MS = 5000;
export class StatusPoller {
    timer = null;
    bar;
    constructor(bar) {
        this.bar = bar;
    }
    /**
     * Start polling. Runs an initial poll immediately.
     */
    start() {
        this.pollNow();
        this.timer = setInterval(() => this.pollNow(), POLL_INTERVAL_MS);
    }
    /**
     * Stop polling.
     */
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    /**
     * Run a single poll cycle.  Called automatically by the timer,
     * but can also be called externally after a command that may
     * change service/queue state (e.g. `service start`).
     */
    async pollNow() {
        const status = {};
        // Service status
        try {
            const daemon = await getDaemonStatus();
            status.serviceRunning = daemon.running;
        }
        catch {
            status.serviceRunning = false;
        }
        // Queue size + memory + entity count (only if service is running)
        if (status.serviceRunning) {
            try {
                const client = getServiceClient();
                await client.connect();
                const queueStatus = await client.getQueueStatus();
                const result = queueStatus.result;
                status.queueSize = result.size;
                status.queueMax = result.maxSize;
                const mem = await client.getMemoryUsage();
                status.memoryMB = mem.rss;
                const indexStats = await client.getIndexStats();
                status.entityCount = indexStats.nodeCount;
                client.disconnect();
            }
            catch {
                status.queueSize = 0;
                status.memoryMB = 0;
                status.entityCount = 0;
            }
        }
        else {
            status.queueSize = 0;
            status.memoryMB = 0;
            status.entityCount = 0;
        }
        // Update the status bar data (doesn't print — that happens before each prompt)
        this.bar.update(status);
    }
}
