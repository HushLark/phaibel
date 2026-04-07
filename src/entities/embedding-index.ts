// ─────────────────────────────────────────────────────────────────────────────
// EMBEDDING INDEX
// Semantic search layer for entities using OpenAI embeddings.
// Vectors persist to ~/.phaibel/embeddings.json and load into memory on startup.
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'fs';
import path from 'path';
import { getEmbeddings } from '../llm/router.js';
import { debug } from '../utils/debug.js';
import { getEmbeddingsPath } from '../paths.js';
import type { IndexNode } from './entity-index.js';
import type { EntityIndex } from './entity-index.js';
import type { EntityTypeName } from './entity.js';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface EmbeddingEntry {
    text: string;
    vector: number[];
    updatedAt: string;
}

interface EmbeddingStore {
    version: number;
    model: string;
    dimensions: number;
    entries: Record<string, EmbeddingEntry>;
}

export interface EmbeddingSearchResult {
    key: string;
    similarity: number;
}

export interface SyncResult {
    added: number;
    updated: number;
    removed: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const MODEL = 'text-embedding-3-small';
const DIMENSIONS = 256;
const BATCH_SIZE = 100;
const SIMILARITY_THRESHOLD = 0.5;

function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}

function buildEmbeddingText(node: Pick<IndexNode, 'title' | 'tags' | 'summary' | 'bodySnippet'>): string {
    const parts = [node.title];
    if (node.tags.length > 0) {
        parts.push(`tags: ${node.tags.join(', ')}`);
    }
    if (node.summary) {
        parts.push(node.summary);
    }
    if (node.bodySnippet) {
        parts.push(node.bodySnippet.slice(0, 500));
    }
    return parts.join(' | ');
}

// ─────────────────────────────────────────────────────────────────────────────
// EMBEDDING INDEX
// ─────────────────────────────────────────────────────────────────────────────

export class EmbeddingIndex {
    private store: EmbeddingStore = {
        version: 1,
        model: MODEL,
        dimensions: DIMENSIONS,
        entries: {},
    };
    private dirty = false;
    private _loaded = false;

    // Query vector cache — avoids hitting OpenAI API for repeated queries
    private queryCache = new Map<string, { vector: number[]; ts: number }>();
    private static QUERY_CACHE_MAX = 100;
    private static QUERY_CACHE_TTL = 300_000; // 5 minutes

    get isLoaded(): boolean {
        return this._loaded;
    }

    async load(): Promise<void> {
        try {
            const embeddingsPath = await getEmbeddingsPath();
            const raw = await fs.readFile(embeddingsPath, 'utf-8');
            const parsed = JSON.parse(raw) as EmbeddingStore;

            // If model or dimensions changed, purge and re-embed on next sync
            if (parsed.model !== MODEL || parsed.dimensions !== DIMENSIONS) {
                debug('embeddings', `Model/dimensions changed (${parsed.model}/${parsed.dimensions} → ${MODEL}/${DIMENSIONS}), purging`);
                this.store = { version: 1, model: MODEL, dimensions: DIMENSIONS, entries: {} };
                this.dirty = true;
            } else {
                this.store = parsed;
            }
        } catch {
            // File doesn't exist or is corrupted — start fresh
            debug('embeddings', 'No embeddings.json found, starting fresh');
        }
        this._loaded = true;
    }

    async save(): Promise<void> {
        if (!this.dirty) return;
        const embeddingsPath = await getEmbeddingsPath();
        await fs.mkdir(path.dirname(embeddingsPath), { recursive: true });
        await fs.writeFile(embeddingsPath, JSON.stringify(this.store));
        this.dirty = false;
    }

    async sync(entityIndex: EntityIndex): Promise<SyncResult> {
        const nodes = entityIndex.getNodes();
        const result: SyncResult = { added: 0, updated: 0, removed: 0 };

        // Build set of current keys
        const currentKeys = new Set<string>();
        const toEmbed: { key: string; text: string }[] = [];

        for (const node of nodes) {
            const key = `${node.type}:${node.id}`;
            currentKeys.add(key);
            const text = buildEmbeddingText(node);

            const existing = this.store.entries[key];
            if (!existing || existing.text !== text) {
                toEmbed.push({ key, text });
            }
        }

        // Remove stale entries
        for (const key of Object.keys(this.store.entries)) {
            if (!currentKeys.has(key)) {
                delete this.store.entries[key];
                result.removed++;
                this.dirty = true;
            }
        }

        // Batch embed new/changed entries
        for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
            const batch = toEmbed.slice(i, i + BATCH_SIZE);
            const texts = batch.map(b => b.text);

            try {
                const vectors = await getEmbeddings(texts, DIMENSIONS);
                const now = new Date().toISOString();

                for (let j = 0; j < batch.length; j++) {
                    const isNew = !this.store.entries[batch[j].key];
                    this.store.entries[batch[j].key] = {
                        text: batch[j].text,
                        vector: vectors[j],
                        updatedAt: now,
                    };
                    if (isNew) result.added++;
                    else result.updated++;
                }
                this.dirty = true;
            } catch (err) {
                debug('embeddings', `Batch embed failed: ${err}`);
                throw err;
            }
        }

        await this.save();
        return result;
    }

    async upsert(key: string, node: Pick<IndexNode, 'title' | 'tags' | 'summary' | 'bodySnippet'>): Promise<void> {
        const text = buildEmbeddingText(node);
        const existing = this.store.entries[key];

        // Skip if text hasn't changed
        if (existing?.text === text) return;

        try {
            const [vector] = await getEmbeddings([text], DIMENSIONS);
            this.store.entries[key] = {
                text,
                vector,
                updatedAt: new Date().toISOString(),
            };
            this.dirty = true;
            await this.save();
        } catch (err) {
            debug('embeddings', `Failed to embed ${key}: ${err}`);
        }
    }

    remove(key: string): void {
        if (this.store.entries[key]) {
            delete this.store.entries[key];
            this.dirty = true;
            // Save asynchronously — fire and forget
            this.save().catch(err => debug('embeddings', `Failed to save after remove: ${err}`));
        }
    }

    private async getQueryVector(query: string): Promise<number[] | null> {
        const cached = this.queryCache.get(query);
        if (cached && Date.now() - cached.ts < EmbeddingIndex.QUERY_CACHE_TTL) {
            return cached.vector;
        }
        try {
            const [vector] = await getEmbeddings([query], DIMENSIONS);
            // Evict oldest if full
            if (this.queryCache.size >= EmbeddingIndex.QUERY_CACHE_MAX) {
                let oldestKey: string | null = null;
                let oldestTs = Infinity;
                for (const [k, v] of this.queryCache) {
                    if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
                }
                if (oldestKey) this.queryCache.delete(oldestKey);
            }
            this.queryCache.set(query, { vector, ts: Date.now() });
            return vector;
        } catch (err) {
            debug('embeddings', `Failed to embed query: ${err}`);
            return null;
        }
    }

    async search(query: string, topK = 5, entityType?: EntityTypeName): Promise<EmbeddingSearchResult[]> {
        const entries = Object.entries(this.store.entries);
        if (entries.length === 0) return [];

        const queryVector = await this.getQueryVector(query);
        if (!queryVector) return [];

        const results: EmbeddingSearchResult[] = [];

        for (const [key, entry] of entries) {
            // Filter by entity type if specified
            if (entityType && !key.startsWith(`${entityType}:`)) continue;

            const similarity = cosineSimilarity(queryVector, entry.vector);
            if (similarity >= SIMILARITY_THRESHOLD) {
                results.push({ key, similarity });
            }
        }

        results.sort((a, b) => b.similarity - a.similarity);
        return results.slice(0, topK);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────

let _embeddingIndex: EmbeddingIndex | null = null;

export function getEmbeddingIndex(): EmbeddingIndex {
    if (!_embeddingIndex) {
        _embeddingIndex = new EmbeddingIndex();
    }
    return _embeddingIndex;
}

/** Reset the singleton (for testing/eval harness). */
export function resetEmbeddingIndex(): void {
    _embeddingIndex = null;
}
