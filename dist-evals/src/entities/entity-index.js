// ─────────────────────────────────────────────────────────────────────────────
// ENTITY INDEX & RELATIONSHIP GRAPH
// ─────────────────────────────────────────────────────────────────────────────
//
// In-memory index of all entities in the active project.
// Stores lightweight node records (id, type, title, filepath) and a directed
// edge list extracted from @slug (people) and type:slug (entity) references.
// ─────────────────────────────────────────────────────────────────────────────
import { getPlatform } from '../platform/index.js';
import { getVaultRoot } from '../state/manager.js';
import { parseEntity } from './entity.js';
import { loadEntityTypes } from './entity-type-config.js';
import { extractPeopleMentions, extractEntityRefs } from '../context/mentions.js';
import { debug } from '../utils/debug.js';
// Entity type list and directory mapping are now loaded dynamically from
// entity-type-config so that user-defined types are automatically indexed.
/**
 * Extract validated links from entity frontmatter `links` field.
 */
function extractFrontmatterLinks(meta) {
    const raw = meta.links;
    if (!Array.isArray(raw))
        return [];
    const links = [];
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
    nodes = new Map(); // key = "type:id"
    edges = [];
    _builtAt = null;
    // ── Key helpers ─────────────────────────────────────────────────────
    static key(type, id) {
        return `${type}:${id}`;
    }
    // ── Build ───────────────────────────────────────────────────────────
    /**
     * Scan all entity directories, build node map and edge list.
     */
    async build() {
        const { storage, paths } = getPlatform();
        const vaultRoot = await getVaultRoot();
        const entityTypes = await loadEntityTypes();
        // Pass 1: collect all nodes
        for (const typeConfig of entityTypes) {
            const entityType = typeConfig.name;
            const dir = paths.join(vaultRoot, typeConfig.directory);
            try {
                const files = await storage.readdir(dir);
                for (const file of files) {
                    if (!file.endsWith('.md') || file.startsWith('.'))
                        continue;
                    const filepath = paths.join(dir, file);
                    try {
                        const raw = await storage.readFile(filepath, 'utf-8');
                        const { meta, content } = parseEntity(filepath, raw);
                        const id = meta.id || paths.basename(file, '.md');
                        const key = EntityIndex.key(entityType, id);
                        const nodeName = meta.name || meta.title || id;
                        const nodeDesc = meta.description || meta.summary || '';
                        this.nodes.set(key, {
                            id,
                            type: entityType,
                            name: nodeName,
                            title: nodeName, // alias
                            filepath,
                            tags: Array.isArray(meta.tags) ? meta.tags : [],
                            description: nodeDesc,
                            summary: nodeDesc, // alias
                            bodySnippet: content.slice(0, 500),
                            meta,
                        });
                    }
                    catch (err) {
                        debug('index', `Failed to parse ${filepath}: ${err}`);
                    }
                }
            }
            catch {
                // Directory doesn't exist — skip
            }
        }
        // Pass 2: extract edges from content and frontmatter links
        const typeNames = entityTypes.map(t => t.name);
        for (const typeConfig of entityTypes) {
            const entityType = typeConfig.name;
            const dir = paths.join(vaultRoot, typeConfig.directory);
            try {
                const files = await storage.readdir(dir);
                for (const file of files) {
                    if (!file.endsWith('.md') || file.startsWith('.'))
                        continue;
                    const filepath = paths.join(dir, file);
                    try {
                        const raw = await storage.readFile(filepath, 'utf-8');
                        const { meta, content } = parseEntity(filepath, raw);
                        const id = meta.id || paths.basename(file, '.md');
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
                        // reference-typed schema fields → typed graph edges
                        const referenceFields = typeConfig.fields.filter(f => f.type === 'reference');
                        for (const rf of referenceFields) {
                            const refVal = meta[rf.key];
                            if (typeof refVal === 'string' && refVal) {
                                const targetKey = rf.targetType
                                    ? EntityIndex.key(rf.targetType, refVal)
                                    : refVal;
                                if (this.nodes.has(targetKey)) {
                                    this.edges.push({
                                        source: sourceKey,
                                        target: targetKey,
                                        edgeType: 'link',
                                        label: rf.key,
                                    });
                                }
                            }
                        }
                    }
                    catch (err) {
                        debug('index', `Failed to extract refs from ${filepath}: ${err}`);
                    }
                }
            }
            catch {
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
    async rebuild() {
        this.nodes.clear();
        this.edges = [];
        this._builtAt = null;
        await this.build();
    }
    // ── Incremental mutations ────────────────────────────────────────────
    get isBuilt() {
        return this._builtAt !== null;
    }
    /**
     * Add or update a single node and re-scan its content for edges.
     * Avoids a full rebuild when a single entity is created or modified.
     */
    async addOrUpdate(type, id, name, filepath, tags, description) {
        const { storage } = getPlatform();
        const key = EntityIndex.key(type, id);
        // Read file for bodySnippet and full meta
        let bodySnippet = '';
        let meta = {};
        try {
            const raw = await storage.readFile(filepath, 'utf-8');
            const parsed = parseEntity(filepath, raw);
            bodySnippet = parsed.content.slice(0, 500);
            meta = parsed.meta;
        }
        catch { /* keep defaults */ }
        // Upsert node
        this.nodes.set(key, { id, type, name, title: name, filepath, tags: tags ?? [], description: description ?? '', summary: description ?? '', bodySnippet, meta });
        // Remove old outbound edges from this node
        this.edges = this.edges.filter(e => e.source !== key);
        // Re-scan content and frontmatter for new edges
        try {
            const raw = await storage.readFile(filepath, 'utf-8');
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
        }
        catch (err) {
            debug('index', `Failed to scan edges for ${filepath}: ${err}`);
        }
        debug('index', `Index updated: ${type}:${id} (${this.nodes.size} nodes, ${this.edges.length} edges)`);
    }
    /**
     * Remove a node and all its inbound/outbound edges.
     */
    remove(type, id) {
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
    search(query, entityType) {
        const rawTokens = query.toLowerCase().split(/\s+/).filter(Boolean);
        // Separate tag:value tokens from regular search tokens
        const tagTokens = [];
        const searchTokens = [];
        for (const token of rawTokens) {
            if (token.startsWith('tag:') || token.startsWith('tags:')) {
                const tagValue = token.slice(token.indexOf(':') + 1);
                if (tagValue)
                    tagTokens.push(tagValue);
            }
            else {
                searchTokens.push(token);
            }
        }
        if (searchTokens.length === 0 && tagTokens.length === 0)
            return [];
        const results = [];
        for (const node of this.nodes.values()) {
            if (entityType && node.type !== entityType)
                continue;
            const titleLower = node.name.toLowerCase();
            const tagsLower = node.tags.map(t => t.toLowerCase());
            const summaryLower = node.description.toLowerCase();
            // Pre-filter by tag tokens if present
            if (tagTokens.length > 0) {
                const hasMatchingTag = tagTokens.some(ft => tagsLower.includes(ft));
                if (!hasMatchingTag)
                    continue;
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
                if (titleLower.includes(token)) {
                    score += 3;
                    matched = true;
                }
                if (tagsLower.some(tag => tag.includes(token))) {
                    score += 2;
                    matched = true;
                }
                if (summaryLower.includes(token)) {
                    score += 1;
                    matched = true;
                }
                if (!matched) {
                    allMatched = false;
                    break;
                }
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
    findByTitle(entityType, titleOrId) {
        const needle = titleOrId.toLowerCase();
        let partialMatch = null;
        for (const node of this.nodes.values()) {
            if (node.type !== entityType)
                continue;
            if (node.id === titleOrId || node.name.toLowerCase() === needle) {
                return node;
            }
            if (!partialMatch) {
                const nameLower = node.name.toLowerCase();
                if (nameLower.includes(needle) || needle.includes(nameLower)) {
                    partialMatch = node;
                }
            }
        }
        return partialMatch;
    }
    // ── Queries ──────────────────────────────────────────────────────────
    getNode(key) {
        return this.nodes.get(key);
    }
    getNodes(type) {
        const all = [...this.nodes.values()];
        return type ? all.filter(n => n.type === type) : all;
    }
    getEdgesFrom(key) {
        return this.edges.filter(e => e.source === key);
    }
    getEdgesTo(key) {
        return this.edges.filter(e => e.target === key);
    }
    getNeighbors(key) {
        const results = [];
        const seen = new Set();
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
    getAllEdges() {
        return [...this.edges];
    }
    getStats() {
        const byType = {};
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
let _index = null;
export function getEntityIndex() {
    if (!_index) {
        _index = new EntityIndex();
    }
    return _index;
}
/** Reset the singleton (for testing/eval harness). */
export function resetEntityIndex() {
    _index = null;
}
