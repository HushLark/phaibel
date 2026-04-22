import net from 'net';
import { promises as fs } from 'fs';
import { debug } from '../utils/debug.js';
/**
 * Unix domain socket server for IPC communication.
 */
export class ServiceServer {
    server = null;
    handler = null;
    connections = new Set();
    /**
     * Set the request handler.
     */
    onRequest(handler) {
        this.handler = handler;
    }
    /**
     * Start the server on the given socket path.
     */
    async start(socketPath) {
        // Remove existing socket file
        try {
            await fs.unlink(socketPath);
        }
        catch (err) {
            debug('server', err);
            // Ignore
        }
        return new Promise((resolve, reject) => {
            this.server = net.createServer((socket) => {
                this.connections.add(socket);
                let buffer = '';
                socket.on('data', async (data) => {
                    buffer += data.toString();
                    // Process complete messages (newline-delimited JSON)
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        if (!line.trim())
                            continue;
                        try {
                            const request = JSON.parse(line);
                            if (this.handler) {
                                const response = await this.handler(request);
                                socket.write(JSON.stringify(response) + '\n');
                            }
                        }
                        catch (error) {
                            const errorResponse = {
                                requestId: 'unknown',
                                status: 'error',
                                error: error instanceof Error ? error.message : 'Unknown error',
                            };
                            socket.write(JSON.stringify(errorResponse) + '\n');
                        }
                    }
                });
                socket.on('close', () => {
                    this.connections.delete(socket);
                });
                socket.on('error', () => {
                    this.connections.delete(socket);
                });
            });
            this.server.on('error', (error) => {
                reject(error);
            });
            this.server.listen(socketPath, () => {
                resolve();
            });
        });
    }
    /**
     * Stop the server and close all connections.
     */
    async stop() {
        // Close all connections
        for (const socket of this.connections) {
            socket.destroy();
        }
        this.connections.clear();
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    this.server = null;
                    resolve();
                });
            }
            else {
                resolve();
            }
        });
    }
    /**
     * Check if server is running.
     */
    isRunning() {
        return this.server !== null && this.server.listening;
    }
}
