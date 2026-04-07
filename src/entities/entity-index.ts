// ─────────────────────────────────────────────────────────────────────────────
// ENTITY INDEX & RELATIONSHIP GRAPH
// ─────────────────────────────────────────────────────────────────────────────
//
// In-memory index of all entities in the active project.
// Stores lightweight node records (id, type, title, filepath) and a directed
// edge list extracted from @slug (people) and type:slug (entity) references.
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'fs';
import path from 'path';
import { getVaultRoot } from '../state/manager.js';
import { parseEntity, type EntityTypeName, type EntityLink } from './entity.js';
import { loadEntityTypes } from './entity-type-config.js';
import { extractPeopleMentions, extractEntityRefs } from '../context/mentions.js';
import { debug } from '../utils/debug.js';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface IndexNode {
    id: string;              // entity id (filename without .md), e.g. "task-abc123"
    type: EntityTypeName;
    title: string;
    filepath: string;
    tags: string[];          // cached from frontmatter
    summary: string;         // cached from frontmatter (LLM-generated)
    bodySnippet: string;     // first 500 chars of body content (for embedding)
    meta: Record<string, unknown>;  // full frontmatter metadata
}

export interface IndexSearchResult {
    node: IndexNode;
    score: number;
}

export interface IndexEdge {
    source: string;          // composite key "type:id"
    target: string;          // composite key "type:id"
    edgeType: 'mention' | 'reference' | 'link';
    label?: string;          // relationship name (for 'link' edges)
}

export interface IndexStats {
    nodeCount: number;
    edgeCount: number;
    byType: Record<string, number>;
    builtAt: string;         // ISO timestamp
}

// Entity type list and directory mapping are now loaded dynamically from
// entity-type-config so that user-defined types are automatically indexed.

/**
 * Extract validated links from entity frontmatter `links` field.
 */
function extractFrontmatterLinks(meta: Record<string, unknown>): EntityLink[] {
    const raw = meta.links;
    if (!Array.isArray(raw)) return [];
    const links: EntityLink[] = [];
    for (const item of raw) {
        if (item && typeof item === 'object' && typeof item.target === 'string' && typeof item.label === 'string') {
            links.push({ target: item.target, label: item.label });
        }
    }
    return links;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTITY INDEX
// ─────────────────────────────────────────────────────────────────────────────

export class EntityIndex {
    private nodes = new Map<string, IndexNode>();     // key = "type:id"
    private edges: IndexEdge[] = [];
    private _builtAt: Date | null = null;

    // ── Key helpers ─────────────────────────────────────────────────────

    private static key(type: EntityTypeName, id: string): string {
        return `${type}:${id}`;
    }

    // ── Build ───────────────────────────────────────────────────────────

    /**
     * Scan all entity directories, build node map and edge list.
     */
    async build(): Promise<void> {
        const vaultRoot = await getVaultRoot();
        const entityTypes = await loadEntityTypes();

        // Pass 1: collect all nodes
        for (const typeConfig of entityTypes) {
            const entityType = typeConfig.name;
            const dir = path.join(vaultRoot, typeConfig.directory);

            try {
                const files = await fs.readdir(dir);
                for (const file of files) {
                    if (!file.endsWith('.md') || file.startsWith('.')) continue;

                    const filepath = path.join(dir, file);

                    try {
                        const raw = await fs.readFile(filepath, 'utf-8');
                        const { meta, content } = parseEntity(filepath, raw);
                        const id = (meta.id as string) || path.basename(file, '.md');
                        const key = EntityIndex.key(entityType, id);

                        this.nodes.set(key, {
                            id,
                            type: entityType,
                            title: (meta.title as string) || id,
                            filepath,
                            tags: Array.isArray(meta.tags) ? (meta.tags as string[]) : [],
                            summary: (meta.summary as string) ?? '',
                            bodySnippet: content.slice(0, 500),
                            meta,
                        });
                    } catch (err) {
                        debug('index', `Failed to parse ${filepath}: ${err}`);
                    }
                }
            } catch {
                // Directory doesn't exist — skip
            }
        }

        // Pass 2: extract edges from content and frontmatter links
        const typeNames = entityTypes.map(t => t.name);
        for (const typeConfig of entityTypes) {
            const entityType = typeConfig.name;
            const dir = path.join(vaultRoot, typeConfig.directory);

            try {
                const files = await fs.readdir(dir);
                for (const file of files) {
                    if (!file.endsWith('.md') || file.startsWith('.')) continue;

                    const filepath = path.join(dir, file);

                    try {
                        const raw = await fs.readFile(filepath, 'utf-8');
                        const { meta, content } = parseEntity(filepath, raw);
                        const id = (meta.id as string) || path.basename(file, '.md');
                        const sourceKey = EntityIndex.key(entityType, id);

                        // @slug → person mention edges
                        const peopleSlugs = extractPeopleMentions(content);
                        for (const slug of peopleSlugs) {
                            const targetKey = EntityIndex.key('person', slug);
                            if (this.nodes.has(targetKey)) {
                                this.edges.push({
                                    source: sourceKey,
                                    target: targetKey,
                                    edgeType: 'mention',
                                });
                            }
                        }

                        // type:slug → entity reference edges
                        const entityRefs = extractEntityRefs(content, typeNames);
                        for (const ref of entityRefs) {
                            const targetKey = EntityIndex.key(ref.type, ref.slug);
                            if (this.nodes.has(targetKey)) {
                                this.edges.push({
                                    source: sourceKey,
                                    target: targetKey,
                                    edgeType: 'reference',
                                });
                            }
                        }

                        // frontmatter links → labeled link edges
                        const fmLinks = extractFrontmatterLinks(meta);
                        for (const link of fmLinks) {
                            if (this.nodes.has(link.target)) {
                                this.edges.push({
                                    source: sourceKey,
                                    target: link.target,
                                    edgeType: 'link',
                                    label: link.label,
                                });
                            }
                        }
                    } catch (err) {
                        debug('index', `Failed to extract refs from ${filepath}: ${err}`);
                    }
                }
            } catch {
                // Directory doesn't exist — skip
            }
        }

        this._builtAt = new Date();
        if (process.env.PHAIBEL_DEBUG === '1') {
            console.debug(`[index] Built index: ${this.nodes.size} nodes, ${this.edges.length} edges`);
        }
    }

    /**
     * Clear and rebuild the index.
     */
    async rebuild(): Promise<void> {
        this.nodes.clear();
        this.edges = [];
        this._builtAt = null;
        await this.build();
    }

    // ── Incremental mutations ────────────────────────────────────────────

    get isBuilt(): boolean {
        return this._builtAt !== null;
    }

    /**
     * Add or update a single node and re-scan its content for edges.
     * Avoids a full rebuild when a single entity is created or modified.
     */
    async addOrUpdate(type: EntityTypeName, id: string, title: string, filepath: string, tags?: string[], summary?: string): Promise<void> {
        const key = EntityIndex.key(type, id);

        // Read file for bodySnippet and full meta
        let bodySnippet = '';
        let meta: Record<string, unknown> = {};
        try {
            const raw = await fs.readFile(filepath, 'utf-8');
            const parsed = parseEntity(filepath, raw);
            bodySnippet = parsed.content.slice(0, 500);
            meta = parsed.meta;
        } catch { /* keep defaults */ }

        // Upsert node
        this.nodes.set(key, { id, type, title, filepath, tags: tags ?? [], summary: summary ?? '', bodySnippet, meta });

        // Remove old outbound edges from this node
        this.edges = this.edges.filter(e => e.source !== key);

        // Re-scan content and frontmatter for new edges
        try {
            const raw = await fs.readFile(filepath, 'utf-8');
            const { meta, content } = parseEntity(filepath, raw);

            const peopleSlugs = extractPeopleMentions(content);
            for (const slug of peopleSlugs) {
                const targetKey = EntityIndex.key('person', slug);
                if (this.nodes.has(targetKey)) {
                    this.edges.push({ source: key, target: targetKey, edgeType: 'mention' });
                }
            }

            const entityTypes = await loadEntityTypes();
            const typeNames = entityTypes.map(t => t.name);
            const entityRefs = extractEntityRefs(content, typeNames);
            for (const ref of entityRefs) {
                const targetKey = EntityIndex.key(ref.type, ref.slug);
                if (this.nodes.has(targetKey)) {
                    this.edges.push({ source: key, target: targetKey, edgeType: 'reference' });
                }
            }

            const fmLinks = extractFrontmatterLinks(meta);
            for (const link of fmLinks) {
                if (this.nodes.has(link.target)) {
                    this.edges.push({ source: key, target: link.target, edgeType: 'link', label: link.label });
                }
            }
        } catch (err) {
            debug('index', `Failed to scan edges for ${filepath}: ${err}`);
        }

        debug('index', `Index updated: ${type}:${id} (${this.nodes.size} nodes, ${this.edges.length} edges)`);
    }

    /**
     * Remove a node and all its inbound/outbound edges.
     */
    remove(type: EntityTypeName, id: string): void {
        const key = EntityIndex.key(type, id);
        this.nodes.delete(key);
        this.edges = this.edges.filter(e => e.source !== key && e.target !== key);
        debug('index', `Index removed: ${type}:${id} (${this.nodes.size} nodes, ${this.edges.length} edges)`);
    }

    // ── Search ──────────────────────────────────────────────────────────

    /**
     * Search nodes by query against title, tags, and summary.
     * Tokenizes query; scoring: title=3, tag=2, summary=1 per token.
     * All tokens must match at least one field.
     */
    search(query: string, entityType?: EntityTypeName): IndexSearchResult[] {
        const rawTokens = query.toLowerCase().split(/\s+/).filter(Boolean);

        // Separate tag:value tokens from regular search tokens
        const tagTokens: string[] = [];
        const searchTokens: string[] = [];
        for (const token of rawTokens) {
            if (token.startsWith('tag:') || token.startsWith('tags:')) {
                const tagValue = token.slice(token.indexOf(':') + 1);
                if (tagValue) tagTokens.push(tagValue);
            } else {
                searchTokens.push(token);
            }
        }

        if (searchTokens.length === 0 && tagTokens.length === 0) return [];

        const results: IndexSearchResult[] = [];

        for (const node of this.nodes.values()) {
            if (entityType && node.type !== entityType) continue;

            const titleLower = node.title.toLowerCase();
            const tagsLower = node.tags.map(t => t.toLowerCase());
            const summaryLower = node.summary.toLowerCase();

            // Pre-filter by tag tokens if present
            if (tagTokens.length > 0) {
                const hasMatchingTag = tagTokens.some(ft => tagsLower.includes(ft));
                if (!hasMatchingTag) continue;
            }

            // If no search tokens, return all tag-matched nodes
            if (searchTokens.length === 0) {
                results.push({ node, score: 1 });
                continue;
            }

            let score = 0;
            let allMatched = true;

            for (const token of searchTokens) {
                let matched = false;
                if (titleLower.includes(token)) { score += 3; matched = true; }
                if (tagsLower.some(tag => tag.includes(token))) { score += 2; matched = true; }
                if (summaryLower.includes(token)) { score += 1; matched = true; }
                if (!matched) { allMatched = false; break; }
            }

            if (allMatched && score > 0) {
                results.push({ node, score });
            }
        }

        results.sort((a, b) => b.score - a.score);
        return results;
    }

    /**
     * Find a single node by exact or partial title match.
     * Exact match on id or title (case-insensitive), fallback to partial.
     */
    findByTitle(entityType: EntityTypeName, titleOrId: string): IndexNode | null {
        const needle = titleOrId.toLowerCase();
        let partialMatch: IndexNode | null = null;

        for (const node of this.nodes.values()) {
            if (node.type !== entityType) continue;

            // Exact match on id or title
            if (node.id === titleOrId || node.title.toLowerCase() === needle) {
                return node;
            }

            // Partial match
            if (!partialMatch) {
                const titleLower = node.title.toLowerCase();
                if (titleLower.includes(needle) || needle.includes(titleLower)) {
                    partialMatch = node;
                }
            }
        }

        return partialMatch;
    }

    // ── Queries ──────────────────────────────────────────────────────────

    getNode(key: string): IndexNode | undefined {
        return this.nodes.get(key);
    }

    getNodes(type?: EntityTypeName): IndexNode[] {
        const all = [...this.nodes.values()];
        return type ? all.filter(n => n.type === type) : all;
    }

    getEdgesFrom(key: string): IndexEdge[] {
        return this.edges.filter(e => e.source === key);
    }

    getEdgesTo(key: string): IndexEdge[] {
        return this.edges.filter(e => e.target === key);
    }

    getNeighbors(key: string): { node: IndexNode; direction: 'out' | 'in'; edgeType: string; label?: string }[] {
        const results: { node: IndexNode; direction: 'out' | 'in'; edgeType: string; label?: string }[] = [];
        const seen = new Set<string>();

        for (const edge of this.edges) {
            if (edge.source === key && !seen.has(`out:${edge.target}`)) {
                const node = this.nodes.get(edge.target);
                if (node) {
                    results.push({ node, direction: 'out', edgeType: edge.edgeType, label: edge.label });
                    seen.add(`out:${edge.target}`);
                }
            }
            if (edge.target === key && !seen.has(`in:${edge.source}`)) {
                const node = this.nodes.get(edge.source);
                if (node) {
                    results.push({ node, direction: 'in', edgeType: edge.edgeType, label: edge.label });
                    seen.add(`in:${edge.source}`);
                }
            }
        }

        return results;
    }

    getAllEdges(): IndexEdge[] {
        return [...this.edges];
    }

    getStats(): IndexStats {
        const byType: Record<string, number> = {};
        for (const node of this.nodes.values()) {
            byType[node.type] = (byType[node.type] || 0) + 1;
        }
        return {
            nodeCount: this.nodes.size,
            edgeCount: this.edges.length,
            byType,
            builtAt: this._builtAt?.toISOString() || 'never',
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────

let _index: EntityIndex | null = null;

export function getEntityIndex(): EntityIndex {
    if (!_index) {
        _index = new EntityIndex();
    }
    return _index;
}

/** Reset the singleton (for testing/eval harness). */
export function resetEntityIndex(): void {
    _index = null;
}
