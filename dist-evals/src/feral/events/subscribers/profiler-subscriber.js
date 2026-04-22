// ─────────────────────────────────────────────────────────────────────────────
// Feral Agent — Profiler Event Subscriber
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Creates a subscriber that records timing data for each node.
 * Uses a ProcessTraceCollector to build a trace of the process execution.
 */
export function createProfilerSubscriber(collector, onComplete) {
    return (dispatcher) => {
        dispatcher.on('process.start', (e) => {
            collector.startProcess(e.process.key);
        });
        dispatcher.on('process.node.before', (e) => {
            collector.startNode(e.node.key);
        });
        dispatcher.on('process.node.after', (e) => {
            collector.endNode(e.node.key, e.result.status, e.result.message);
        });
        dispatcher.on('process.end', () => {
            const trace = collector.endProcess();
            if (onComplete) {
                onComplete(trace);
            }
        });
    };
}
