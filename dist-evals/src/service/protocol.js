// Service protocol types for IPC communication
// ─────────────────────────────────────────────────────────────────────────────
// ERRORS
// ─────────────────────────────────────────────────────────────────────────────
export class QueueFullError extends Error {
    constructor() {
        super('Queue is at maximum capacity (10). Please wait for tasks to complete.');
        this.name = 'QueueFullError';
    }
}
export class ServiceNotRunningError extends Error {
    constructor() {
        super('Service is not running. Start it with: phaibel start');
        this.name = 'ServiceNotRunningError';
    }
}
