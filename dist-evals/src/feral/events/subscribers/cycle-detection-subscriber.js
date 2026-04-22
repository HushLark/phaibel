// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Cycle Detection Event Subscriber
// ─────────────────────────────────────────────────────────────────────────────
import { MaximumNodeRunsError } from '../../errors.js';
/**
 * Creates a subscriber that detects infinite loops by counting
 * how many times each node executes. Throws if a node exceeds maxRuns.
 */
export function createCycleDetectionSubscriber(maxRuns) {
    return (dispatcher) => {
        const counts = new Map();
        dispatcher.on('process.node.before', (e) => {
            const count = (counts.get(e.node.key) ?? 0) + 1;
            counts.set(e.node.key, count);
            if (count > maxRuns) {
                throw new MaximumNodeRunsError(e.node.key, maxRuns);
            }
        });
    };
}
