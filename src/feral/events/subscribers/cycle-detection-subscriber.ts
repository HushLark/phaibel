// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Cycle Detection Event Subscriber
// ─────────────────────────────────────────────────────────────────────────────

import { MaximumNodeRunsError } from '../../errors.js';
import type { EventDispatcher } from '../event-dispatcher.js';
import type { ProcessNodeBeforeEvent } from '../events.js';
import type { Context } from '../../context/context.js';

/**
 * Creates a subscriber that detects infinite loops by counting how many times
 * each node executes WITHIN one process run. The engine follows edges without
 * checking acyclicity, so an LLM-generated process with a bad back-edge (e.g.
 * link → not_found → find → link) otherwise spins forever with no LLM calls
 * and no log output — a silent hang.
 *
 * Counts are scoped per run Context (WeakMap — no accumulation across the
 * daemon's lifetime, no leak), so long-lived dispatchers can wire this once.
 * Throws MaximumNodeRunsError; the action loop surfaces it as a failed step
 * the designer can repair.
 */
export function createCycleDetectionSubscriber(
    maxRuns: number,
): (dispatcher: EventDispatcher) => void {
    return (dispatcher) => {
        const countsByRun = new WeakMap<Context, Map<string, number>>();

        dispatcher.on<ProcessNodeBeforeEvent>('process.node.before', (e) => {
            let counts = countsByRun.get(e.context);
            if (!counts) {
                counts = new Map<string, number>();
                countsByRun.set(e.context, counts);
            }
            const count = (counts.get(e.node.key) ?? 0) + 1;
            counts.set(e.node.key, count);
            if (count > maxRuns) {
                throw new MaximumNodeRunsError(e.node.key, maxRuns);
            }
        });
    };
}
