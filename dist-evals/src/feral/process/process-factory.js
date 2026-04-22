// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Process Factory
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Aggregates process sources and builds processes by key with caching.
 */
export class ProcessFactory {
    sources;
    cache = new Map();
    constructor(sources = []) {
        this.sources = sources;
    }
    build(key) {
        if (this.cache.has(key))
            return this.cache.get(key);
        for (const source of this.sources) {
            for (const process of source.getProcesses()) {
                if (process.key === key) {
                    this.cache.set(key, process);
                    return process;
                }
            }
        }
        throw new Error(`Cannot find process with key "${key}".`);
    }
    /**
     * Invalidate cached process by key so the next build() re-scans sources.
     */
    invalidate(key) {
        this.cache.delete(key);
    }
    getAllProcesses() {
        return this.sources.flatMap(s => s.getProcesses());
    }
}
