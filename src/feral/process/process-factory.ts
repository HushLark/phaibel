// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Process Factory
// ─────────────────────────────────────────────────────────────────────────────

import type { Process } from './process.js';

/**
 * A source that provides Process instances.
 */
export interface ProcessSource {
    getProcesses(): Process[];
}

/**
 * Aggregates process sources and builds processes by key with caching.
 */
export class ProcessFactory {
    private cache: Map<string, Process> = new Map();

    constructor(private sources: ProcessSource[] = []) { }

    build(key: string): Process {
        if (this.cache.has(key)) return this.cache.get(key)!;

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
    invalidate(key: string): void {
        this.cache.delete(key);
    }

    getAllProcesses(): Process[] {
        return this.sources.flatMap(s => s.getProcesses());
    }
}
