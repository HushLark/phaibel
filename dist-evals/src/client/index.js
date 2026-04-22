import net from 'net';
import { debug } from '../utils/debug.js';
import { randomUUID } from 'crypto';
import { getDaemonStatus, SOCKET_PATH } from '../service/daemon.js';
import { ServiceNotRunningError } from '../service/protocol.js';
/**
 * Client for communicating with the Phaibel service.
 */
export class ServiceClient {
    socket = null;
    responseBuffer = '';
    responseHandlers = new Map();
    /**
     * Check if the service is running.
     */
    async isServiceRunning() {
        const status = await getDaemonStatus();
        return status.running;
    }
    /**
     * Connect to the service.
     */
    async connect() {
        if (this.socket && !this.socket.destroyed) {
            return;
        }
        const status = await getDaemonStatus();
        if (!status.running) {
            throw new ServiceNotRunningError();
        }
        return new Promise((resolve, reject) => {
            this.socket = net.createConnection(SOCKET_PATH(), () => {
                resolve();
            });
            this.socket.on('data', (data) => {
                this.handleData(data);
            });
            this.socket.on('error', (error) => {
                reject(error);
            });
            this.socket.on('close', () => {
                this.socket = null;
            });
        });
    }
    /**
     * Disconnect from the service.
     */
    disconnect() {
        if (this.socket) {
            this.socket.end();
            this.socket = null;
        }
    }
    /**
     * Check if connected.
     */
    isConnected() {
        return this.socket !== null && !this.socket.destroyed;
    }
    /**
     * Submit a task to the service.
     */
    async submitTask(task) {
        const request = {
            id: randomUUID(),
            type: 'task',
            sessionId: task.sessionId,
            payload: task,
        };
        return this.sendRequest(request);
    }
    /**
     * Get queue size.
     */
    async getQueueSize() {
        const response = await this.query('queue.size');
        return response.result.size;
    }
    /**
     * Get full queue status.
     */
    async getQueueStatus() {
        return this.query('queue.status');
    }
    /**
     * Get service memory usage (in MB).
     */
    async getMemoryUsage() {
        const response = await this.query('service.memory');
        return response.result;
    }
    /**
     * Get entity index stats.
     */
    async getIndexStats() {
        const response = await this.query('index.stats');
        return response.result;
    }
    /**
     * Get all edges in the entity graph.
     */
    async getIndexGraph() {
        const response = await this.query('index.graph');
        return response.result;
    }
    /**
     * Get neighbors of a given entity key.
     */
    async getIndexNeighbors(key) {
        const response = await this.query('index.neighbors', { key });
        return response.result;
    }
    /**
     * Rebuild the entity index.
     */
    async rebuildIndex() {
        const response = await this.query('index.rebuild');
        return response.result;
    }
    /**
     * Get cron scheduler status.
     */
    async getCronStatus() {
        const response = await this.query('cron.status');
        return response.result;
    }
    /**
     * Trigger a cron job immediately.
     */
    async runCronJob(job) {
        const response = await this.query('cron.run', { job });
        if (response.status === 'error') {
            throw new Error(response.error || 'Unknown error');
        }
        return response.result;
    }
    /**
     * Get task status by ID.
     */
    async getTaskStatus(taskId) {
        return this.query('task.status', { taskId });
    }
    /**
     * Clear the queue.
     */
    async clearQueue() {
        return this.control('queue.clear', { confirm: true });
    }
    /**
     * Pause the queue processor.
     */
    async pauseQueue() {
        return this.control('queue.pause');
    }
    /**
     * Resume the queue processor.
     */
    async resumeQueue() {
        return this.control('queue.resume');
    }
    /**
     * Wait for a task to complete.
     */
    async waitForTask(taskId, pollIntervalMs = 500, timeoutMs = 30000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            const response = await this.getTaskStatus(taskId);
            const task = response.result;
            if (!task) {
                return null;
            }
            if (task.status === 'completed' || task.status === 'error') {
                return task;
            }
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        }
        return null;
    }
    /**
     * Send a query request.
     */
    async query(query, params = {}) {
        const request = {
            id: randomUUID(),
            type: 'query',
            payload: { query, ...params },
        };
        return this.sendRequest(request);
    }
    /**
     * Send a control request.
     */
    async control(control, params = {}) {
        const request = {
            id: randomUUID(),
            type: 'control',
            payload: { control, ...params },
        };
        return this.sendRequest(request);
    }
    /**
     * Send a request and wait for response.
     */
    async sendRequest(request) {
        if (!this.socket || this.socket.destroyed) {
            await this.connect();
        }
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.responseHandlers.delete(request.id);
                reject(new Error('Request timeout'));
            }, 30000);
            this.responseHandlers.set(request.id, {
                resolve: (response) => {
                    clearTimeout(timeout);
                    resolve(response);
                },
                reject: (error) => {
                    clearTimeout(timeout);
                    reject(error);
                },
            });
            this.socket.write(JSON.stringify(request) + '\n');
        });
    }
    /**
     * Handle incoming data.
     */
    handleData(data) {
        this.responseBuffer += data.toString();
        const lines = this.responseBuffer.split('\n');
        this.responseBuffer = lines.pop() || '';
        for (const line of lines) {
            if (!line.trim())
                continue;
            try {
                const response = JSON.parse(line);
                const handler = this.responseHandlers.get(response.requestId);
                if (handler) {
                    this.responseHandlers.delete(response.requestId);
                    handler.resolve(response);
                }
            }
            catch (err) {
                debug('client', err);
                // Ignore parse errors
            }
        }
    }
}
// Singleton instance
let client = null;
export function getServiceClient() {
    if (!client) {
        client = new ServiceClient();
    }
    return client;
}
