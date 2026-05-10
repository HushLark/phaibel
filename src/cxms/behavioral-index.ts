// ─────────────────────────────────────────────────────────────────────────────
// CxMS BEHAVIORAL INDEX
// Tracks interaction frequency per entity node. Persists to
// {vault}/.phaibel/behavioral.json as a simple key→count map.
//
// "Interaction" means: a node was returned from search, explicitly fetched,
// or appeared in gathered context. No LLM — pure counters.
//
// Score formula: log(1 + count) / log(1 + maxCount)  →  [0, 1]
// Log-scale prevents heavily-used nodes from drowning out everything else.
// ─────────────────────────────────────────────────────────────────────────────

import { getPlatform } from '../platform/index.js';
import { getVaultConfigDir } from '../paths.js';
import { debug } from '../utils/debug.js';

interface BehavioralStore {
    version: number;
    counts: Record<string, number>;
}

const FILENAME = 'behavioral.json';
const SAVE_DEBOUNCE_MS = 5_000;

export class BehavioralIndex {
    private counts: Record<string, number> = {};
    private maxCount = 1;
    private dirty = false;
    private _loaded = false;
    private _saveTimer: ReturnType<typeof setTimeout> | null = null;

    get isLoaded(): boolean { return this._loaded; }

    async load(): Promise<void> {
        try {
            const { storage, paths } = getPlatform();
            const dir = await getVaultConfigDir();
            const filePath = paths.join(dir, FILENAME);
            const raw = await storage.readFile(filePath, 'utf-8');
            const parsed: BehavioralStore = JSON.parse(raw);
            this.counts = parsed.counts ?? {};
            this.maxCount = Math.max(1, ...Object.values(this.counts));
        } catch {
            this.counts = {};
            this.maxCount = 1;
        }
        this._loaded = true;
    }

    async save(): Promise<void> {
        if (!this.dirty) return;
        try {
            const { storage, paths } = getPlatform();
            const dir = await getVaultConfigDir();
            const filePath = paths.join(dir, FILENAME);
            const store: BehavioralStore = { version: 1, counts: this.counts };
            await storage.writeFile(filePath, JSON.stringify(store));
            this.dirty = false;
        } catch (err) {
            debug('behavioral', `Save failed: ${err}`);
        }
    }

    /** Record an interaction with a node key (e.g. "person:alice-chen"). */
    record(key: string): void {
        this.counts[key] = (this.counts[key] ?? 0) + 1;
        if (this.counts[key] > this.maxCount) this.maxCount = this.counts[key];
        this.dirty = true;
        this._scheduleSave();
    }

    /** Record interactions for multiple keys at once. */
    recordMany(keys: string[]): void {
        for (const key of keys) {
            this.counts[key] = (this.counts[key] ?? 0) + 1;
            if (this.counts[key] > this.maxCount) this.maxCount = this.counts[key];
        }
        if (keys.length > 0) {
            this.dirty = true;
            this._scheduleSave();
        }
    }

    /** Get a normalized [0, 1] behavioral score for a node key. */
    getScore(key: string): number {
        const count = this.counts[key] ?? 0;
        return Math.log(1 + count) / Math.log(1 + this.maxCount);
    }

    /** Get raw interaction count for a node key. */
    getCount(key: string): number {
        return this.counts[key] ?? 0;
    }

    private _scheduleSave(): void {
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
            this.save().catch(err => debug('behavioral', `Deferred save failed: ${err}`));
            this._saveTimer = null;
        }, SAVE_DEBOUNCE_MS);
    }
}

let _instance: BehavioralIndex | null = null;

export function getBehavioralIndex(): BehavioralIndex {
    if (!_instance) _instance = new BehavioralIndex();
    return _instance;
}

export function resetBehavioralIndex(): void {
    _instance = null;
}
