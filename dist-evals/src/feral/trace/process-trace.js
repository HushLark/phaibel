// ─────────────────────────────────────────────────────────────────────────────
// Feral Agent — Process Trace
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Default implementation of ProcessTraceCollector.
 */
export class DefaultProcessTraceCollector {
    processKey = '';
    processStartTime = 0;
    nodeStartTimes = new Map();
    entries = [];
    startProcess(processKey) {
        this.processKey = processKey;
        this.processStartTime = Date.now();
        this.entries = [];
        this.nodeStartTimes.clear();
    }
    endProcess() {
        const endTime = Date.now();
        return {
            processKey: this.processKey,
            startTime: this.processStartTime,
            endTime,
            totalDurationMs: endTime - this.processStartTime,
            entries: [...this.entries],
        };
    }
    startNode(nodeKey) {
        this.nodeStartTimes.set(nodeKey, Date.now());
    }
    endNode(nodeKey, resultStatus, resultMessage) {
        const startTime = this.nodeStartTimes.get(nodeKey) ?? Date.now();
        const endTime = Date.now();
        this.entries.push({
            nodeKey,
            startTime,
            endTime,
            durationMs: endTime - startTime,
            resultStatus,
            resultMessage,
        });
    }
}
