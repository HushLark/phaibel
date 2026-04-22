// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — JSON Process Source
// ─────────────────────────────────────────────────────────────────────────────
//
// Loads process JSON files from a directory and provides them as
// Process instances via the ProcessSource interface.
// ─────────────────────────────────────────────────────────────────────────────
import { getPlatform } from '../../platform/index.js';
import { hydrateProcess } from './process-json-hydrator.js';
/**
 * Loads all *.json files from a directory and hydrates them into Processes.
 */
export class JsonProcessSource {
    directory;
    processes = [];
    loaded = false;
    constructor(directory) {
        this.directory = directory;
    }
    /**
     * Load processes from disk. Call once before accessing getProcesses().
     * Silently handles missing directories.
     */
    async load() {
        this.processes = [];
        try {
            const { storage, paths } = getPlatform();
            const files = await storage.readdir(this.directory);
            for (const file of files) {
                if (!file.endsWith('.json'))
                    continue;
                try {
                    const filepath = paths.join(this.directory, file);
                    const raw = await storage.readFile(filepath);
                    const json = JSON.parse(raw);
                    this.processes.push(hydrateProcess(json));
                }
                catch {
                    // Skip invalid files
                }
            }
        }
        catch {
            // Directory doesn't exist — no processes to load
        }
        this.loaded = true;
    }
    getProcesses() {
        if (!this.loaded) {
            throw new Error('JsonProcessSource.load() must be called before getProcesses().');
        }
        return this.processes;
    }
}
