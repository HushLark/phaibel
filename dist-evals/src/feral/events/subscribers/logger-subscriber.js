// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Logger Event Subscriber
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Creates a subscriber that logs process lifecycle events.
 */
export function createLoggerSubscriber(logger) {
    return (dispatcher) => {
        dispatcher.on('process.start', (e) => {
            logger(`Process "${e.process.key}" started`);
        });
        dispatcher.on('process.end', (e) => {
            logger(`Process "${e.process.key}" ended`);
        });
        dispatcher.on('process.node.after', (e) => {
            logger(`Node "${e.node.key}" → ${e.result.status}: ${e.result.message}`);
        });
        dispatcher.on('process.exception', (e) => {
            logger(`Exception in node: ${e.error.message}`);
        });
    };
}
