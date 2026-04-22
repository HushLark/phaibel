// ─────────────────────────────────────────────────────────────────────────────
// ENTITY MODEL
// All records are Entities — markdown files with gray-matter frontmatter.
// ─────────────────────────────────────────────────────────────────────────────
import matter from 'gray-matter';
import { getPlatform } from '../platform/index.js';
import { debug } from '../utils/debug.js';
import { getVaultRoot } from '../state/manager.js';
import { getEntityType, loadEntityTypes } from './entity-type-config.js';
import { getEntityIndex } from './entity-index.js';
import { getEmbeddingIndex } from './embedding-index.js';
import { assertWithinFoundation } from '../cxms/boundary-guard.js';
// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Generate a unique node id: 8 lowercase alphanumeric characters.
 * e.g. "a1b2c3d4", "x9y8z7w6"
 */
export function generateNodeId() {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
    let id = '';
    // First char must be alpha per system naming rules
    const alpha = 'abcdefghijklmnopqrstuvwxyz';
    id += alpha[Math.floor(Math.random() * 26)];
    for (let i = 1; i < 8; i++)
        id += chars[Math.floor(Math.random() * 36)];
    return id;
}
/** @deprecated Use generateNodeId() */
export function generateEntityId(_typeName) {
    return generateNodeId();
}
/**
 * Slugify a title into a URL/filename-safe hyphenated string.
 * Follows system naming rules: lowercase, alphanumeric, hyphens for spaces.
 */
export function slugify(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}
/**
 * Build a filename for a context node: `{slug}_{id}.md`
 * e.g. "Fix the Plumbing" + "a1b2c3d4" → "fix-the-plumbing_a1b2c3d4.md"
 */
export function nodeFilename(title, id) {
    const slug = slugify(title);
    return `${slug}_${id}.md`;
}
/** @deprecated Use nodeFilename() */
export function entityFilename(title, id) {
    return nodeFilename(title, id);
}
/**
 * Create base entity metadata with defaults.
 */
export function createEntityMeta(entityType, title, opts = {}) {
    return {
        id: generateNodeId(),
        name: title,
        entityType,
        created: new Date().toISOString(),
        tags: opts.tags ?? [],
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// PROGRESSIVE DISCLOSURE — BODY FIELD FORMAT
// ─────────────────────────────────────────────────────────────────────────────
// Type-specific fields (status, dueDate, priority, etc.) are stored in the body
// as a leading block of "key: value" lines, terminated by the first blank line.
// Only the 7 core identity fields stay in YAML frontmatter.
// ─────────────────────────────────────────────────────────────────────────────
/** Core identity fields that live in frontmatter — everything else goes to body. */
export const CORE_FRONTMATTER_KEYS = new Set([
    'id', 'entityType', 'contextType',
    'name', 'title', // both accepted; written as 'name'
    'description', 'summary', // both accepted; written as 'description'
    'tags', 'created', 'updated',
]);
/**
 * Parse a scalar value string from a body field line.
 * Handles booleans, integers, floats, JSON arrays/objects, and strings.
 */
function parseFieldScalar(raw) {
    const v = raw.trim();
    if (v === 'true')
        return true;
    if (v === 'false')
        return false;
    if (v === 'null' || v === '~' || v === '')
        return null;
    if (/^-?\d+$/.test(v))
        return parseInt(v, 10);
    if (/^-?\d+\.\d+$/.test(v))
        return parseFloat(v);
    if ((v.startsWith('{') || v.startsWith('['))) {
        try {
            return JSON.parse(v);
        }
        catch { /* fall through */ }
    }
    return v;
}
/**
 * Serialize a value for a body field line.
 */
function serializeFieldScalar(value) {
    if (typeof value === 'boolean' || typeof value === 'number')
        return String(value);
    if (typeof value === 'string')
        return value;
    // Arrays/objects: JSON inline
    return JSON.stringify(value);
}
/**
 * Parse domain fields from the body prefix.
 * Lines at the start matching "key: value" (before the first blank line) are
 * extracted as domain fields; the rest is the user-written content.
 */
export function parseEntityBody(body) {
    const lines = body.split('\n');
    const fields = {};
    let fieldLineCount = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '') {
            // Blank line ends the fields block
            fieldLineCount = i + 1;
            break;
        }
        const match = line.match(/^([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
        if (match) {
            fields[match[1]] = parseFieldScalar(match[2]);
            fieldLineCount = i + 1;
        }
        else {
            // Non-matching line — not a fields block, treat entire body as content
            return { fields: {}, content: body.trim() };
        }
    }
    const content = lines.slice(fieldLineCount).join('\n').trim();
    return { fields, content };
}
/**
 * Serialize domain fields into a body prefix block.
 * Core frontmatter fields are excluded. Returns body string with
 * fields at the top (if any), blank line separator, then content.
 */
export function serializeEntityBody(domainFields, content) {
    const lines = [];
    for (const [key, value] of Object.entries(domainFields)) {
        if (value === undefined || value === null)
            continue;
        lines.push(`${key}: ${serializeFieldScalar(value)}`);
    }
    if (lines.length === 0)
        return content;
    return lines.join('\n') + '\n\n' + content;
}
// ─────────────────────────────────────────────────────────────────────────────
// FILE I/O
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Resolve the directory for an entity type in the active project.
 * Reads the entity type config to get the directory name.
 */
export async function getEntityDir(entityType) {
    const { paths } = getPlatform();
    const vaultRoot = await getVaultRoot();
    const typeConfig = await getEntityType(entityType);
    if (!typeConfig) {
        throw new Error(`Unknown entity type: "${entityType}". Check ~/.phaibel/entity-types.json.`);
    }
    return paths.join(vaultRoot, typeConfig.directory);
}
/**
 * Ensure the entity directory exists, return its path.
 */
export async function ensureEntityDir(entityType) {
    const { storage } = getPlatform();
    const dir = await getEntityDir(entityType);
    await storage.mkdir(dir, { recursive: true });
    return dir;
}
/**
 * Parse a markdown file into an Entity (frontmatter + body content).
 * Supports both legacy format (all fields in frontmatter) and new format
 * (core fields only in frontmatter; domain fields in body prefix block).
 * Always returns a unified meta object with all fields merged.
 */
export function parseEntity(filepath, rawContent) {
    const { data, content: rawBody } = matter(rawContent);
    // Normalise legacy field names (title → name, summary → description)
    if (data.title !== undefined && data.name === undefined) {
        data.name = data.title;
    }
    if (data.summary !== undefined && data.description === undefined) {
        data.description = data.summary;
    }
    // Keep title as alias for backward-compat callers
    if (data.name !== undefined)
        data.title = data.name;
    // Extract domain fields from body prefix (new format)
    const { fields, content } = parseEntityBody(rawBody.trim());
    // Merge: frontmatter wins over body-derived fields for shared keys
    const meta = { ...fields, ...data };
    meta._filepath = filepath;
    return { meta, content };
}
/**
 * Write an entity to a markdown file using the new simplified-frontmatter format.
 * Core fields (id, name, entityType, description, tags, created, updated) go in
 * YAML frontmatter. All domain fields (status, dueDate, priority, etc.) are
 * written as a key:value block at the top of the body.
 */
export async function writeEntity(filepath, meta, content) {
    await assertWithinFoundation(filepath);
    meta.updated = new Date().toISOString();
    const cleanMeta = { ...meta };
    delete cleanMeta._filepath;
    // Normalise: title → name, summary → description
    if (cleanMeta.title !== undefined && cleanMeta.name === undefined) {
        cleanMeta.name = cleanMeta.title;
    }
    delete cleanMeta.title;
    if (cleanMeta.summary !== undefined && cleanMeta.description === undefined) {
        cleanMeta.description = cleanMeta.summary;
    }
    delete cleanMeta.summary;
    // Separate core (frontmatter) from domain (body)
    const frontmatter = {};
    const domainFields = {};
    for (const [key, value] of Object.entries(cleanMeta)) {
        if (value === undefined)
            continue;
        if (CORE_FRONTMATTER_KEYS.has(key)) {
            frontmatter[key] = value;
        }
        else {
            domainFields[key] = value;
        }
    }
    const fullBody = serializeEntityBody(domainFields, content);
    const fileContent = matter.stringify(fullBody, frontmatter);
    await getPlatform().storage.writeFile(filepath, fileContent);
}
/**
 * Move an entity file to the trash instead of permanently deleting it.
 * Trash location: <vaultRoot>/.trash/<entity-dir>/<filename>
 * If a file with the same name exists in trash, appends a timestamp.
 */
export async function trashEntity(filepath) {
    await assertWithinFoundation(filepath);
    const { storage, paths } = getPlatform();
    const { join, basename, dirname } = paths;
    const vaultRoot = await getVaultRoot();
    const trashRoot = join(vaultRoot, '.trash');
    // Derive the entity subdirectory from the filepath
    // e.g. ~/.phaibel/projects/work/todos/foo.md → todos
    const parentDir = basename(dirname(filepath));
    const trashDir = join(trashRoot, parentDir);
    await storage.mkdir(trashDir, { recursive: true });
    const filename = basename(filepath);
    let trashPath = join(trashDir, filename);
    // Avoid collisions — append timestamp if file already exists in trash
    try {
        await storage.access(trashPath);
        const stem = basename(filename, '.md');
        const ts = Date.now();
        trashPath = join(trashDir, `${stem}-${ts}.md`);
    }
    catch {
        // No collision — use original name
    }
    await storage.rename(filepath, trashPath);
    debug('entities', `Trashed ${filepath} → ${trashPath}`);
    return trashPath;
}
/**
 * Find an entity by title or filename within a directory.
 */
export async function findEntityByTitle(entityType, titleOrFilename) {
    const { storage, paths } = getPlatform();
    // Fast path: use in-memory index if built
    const index = getEntityIndex();
    if (index.isBuilt) {
        const node = index.findByTitle(entityType, titleOrFilename);
        if (node) {
            try {
                const rawContent = await storage.readFile(node.filepath, 'utf-8');
                const { meta, content } = parseEntity(node.filepath, rawContent);
                return { filepath: node.filepath, meta, content };
            }
            catch (err) {
                debug('entities', `Index hit but file read failed: ${err}`);
            }
        }
        // Semantic fallback: try embedding similarity search
        const embeddingIndex = getEmbeddingIndex();
        if (embeddingIndex.isLoaded) {
            try {
                const results = await embeddingIndex.search(titleOrFilename, 1, entityType);
                if (results.length > 0) {
                    const matchedNode = index.getNode(results[0].key);
                    if (matchedNode) {
                        debug('entities', `Semantic match for "${titleOrFilename}" → "${matchedNode.title}" (similarity: ${results[0].similarity.toFixed(3)})`);
                        const rawContent = await storage.readFile(matchedNode.filepath, 'utf-8');
                        const { meta, content } = parseEntity(matchedNode.filepath, rawContent);
                        return { filepath: matchedNode.filepath, meta, content };
                    }
                }
            }
            catch (err) {
                debug('entities', `Semantic search failed: ${err}`);
            }
        }
        return null;
    }
    // Fallback: filesystem scan
    let dir;
    try {
        dir = await getEntityDir(entityType);
    }
    catch (err) {
        debug('entities', err);
        return null;
    }
    try {
        const files = await storage.readdir(dir);
        const needle = titleOrFilename.toLowerCase();
        let partialMatch = null;
        for (const file of files) {
            if (!file.endsWith('.md') || file.startsWith('.'))
                continue;
            const filepath = paths.join(dir, file);
            const rawContent = await storage.readFile(filepath, 'utf-8');
            const { meta, content } = parseEntity(filepath, rawContent);
            // Exact match on id or title — return immediately
            if (meta.id === titleOrFilename ||
                (meta.title && meta.title.toLowerCase() === needle)) {
                return { filepath, meta, content };
            }
            // Partial match — title contains search term or vice versa
            if (!partialMatch && meta.title) {
                const titleLower = meta.title.toLowerCase();
                if (titleLower.includes(needle) || needle.includes(titleLower)) {
                    partialMatch = { filepath, meta, content };
                }
            }
        }
        // Fall back to partial match if no exact match found
        if (partialMatch) {
            debug('entities', `No exact match for "${titleOrFilename}", using partial match: "${partialMatch.meta.title}"`);
            return partialMatch;
        }
    }
    catch (err) {
        debug('entities', err);
        // Directory doesn't exist yet
    }
    return null;
}
/**
 * Full-text search across entities by title, tags, and body content.
 * Tokenizes query into words and scores matches: title=3pts, tag=2pts, body=1pt per token.
 * Only returns entities where ALL tokens match at least one field.
 */
export async function searchEntities(query, entityType, options) {
    // Fast path: use in-memory index if built
    const index = getEntityIndex();
    if (index.isBuilt) {
        // Merge explicit tags into query as tag: tokens for the index search
        const tagPrefix = (options?.tags ?? []).map(t => `tag:${t}`).join(' ');
        const fullQuery = tagPrefix ? `${tagPrefix} ${query}` : query;
        // 1. Keyword search via entity index
        const keywordResults = index.search(fullQuery, entityType);
        // 2. Semantic search via embedding index (if available)
        const embeddingIndex = getEmbeddingIndex();
        const mergedScores = new Map();
        // Normalize keyword scores to 0-1 range
        const maxKeyword = keywordResults.length > 0 ? keywordResults[0].score : 1;
        for (const { node, score } of keywordResults) {
            const key = `${node.type}:${node.id}`;
            const normalized = maxKeyword > 0 ? score / maxKeyword : 0;
            mergedScores.set(key, { node, score: normalized * 0.6 });
        }
        if (embeddingIndex.isLoaded && query) {
            try {
                const semanticResults = await embeddingIndex.search(query, 20, entityType ?? undefined);
                for (const { key, similarity } of semanticResults) {
                    const existing = mergedScores.get(key);
                    if (existing) {
                        // Combine: keyword weight + semantic weight
                        existing.score += similarity * 0.4;
                    }
                    else {
                        // Semantic-only hit — find node from index
                        const node = index.getNode(key);
                        if (node) {
                            mergedScores.set(key, { node, score: similarity * 0.4 });
                        }
                    }
                }
            }
            catch (err) {
                debug('entities', `Semantic search failed, using keyword-only: ${err}`);
            }
        }
        // Sort by combined score descending
        const sorted = [...mergedScores.values()].sort((a, b) => b.score - a.score);
        // Read full content from disk for matched nodes
        const { storage } = getPlatform();
        const results = [];
        for (const { node, score } of sorted) {
            try {
                const rawContent = await storage.readFile(node.filepath, 'utf-8');
                const { meta, content } = parseEntity(node.filepath, rawContent);
                results.push({ filepath: node.filepath, meta, content, score });
            }
            catch (err) {
                debug('entities', `Index hit but file read failed for ${node.filepath}: ${err}`);
            }
        }
        return results;
    }
    // Fallback: filesystem scan
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
    // Merge inline tag: tokens with explicit tags option
    const allFilterTags = [...tagTokens, ...(options?.tags ?? []).map(t => t.toLowerCase())];
    if (searchTokens.length === 0 && allFilterTags.length === 0)
        return [];
    // Gather all entities to search
    let allEntities;
    if (entityType) {
        allEntities = await listEntities(entityType);
    }
    else {
        const types = await loadEntityTypes();
        const lists = await Promise.all(types.map(t => listEntities(t.name)));
        allEntities = lists.flat();
    }
    // Pre-filter by tags if any tag filters are specified
    if (allFilterTags.length > 0) {
        allEntities = allEntities.filter(e => {
            const entityTags = (e.meta.tags ?? []).map(t => t.toLowerCase());
            return allFilterTags.some(ft => entityTags.includes(ft));
        });
    }
    // If no search tokens, return all tag-matched entities with score 1
    if (searchTokens.length === 0) {
        return allEntities.map(e => ({ filepath: e.filepath, meta: e.meta, content: e.content, score: 1 }));
    }
    const results = [];
    for (const entity of allEntities) {
        const title = (entity.meta.title ?? '').toLowerCase();
        const tags = (entity.meta.tags ?? []).map(t => t.toLowerCase());
        const body = entity.content.toLowerCase();
        let score = 0;
        let allMatched = true;
        for (const token of searchTokens) {
            let matched = false;
            if (title.includes(token)) {
                score += 3;
                matched = true;
            }
            if (tags.some(tag => tag.includes(token))) {
                score += 2;
                matched = true;
            }
            if (body.includes(token)) {
                score += 1;
                matched = true;
            }
            if (!matched) {
                allMatched = false;
                break;
            }
        }
        if (allMatched && score > 0) {
            results.push({ filepath: entity.filepath, meta: entity.meta, content: entity.content, score });
        }
    }
    results.sort((a, b) => b.score - a.score);
    return results;
}
/**
 * List all entities of a given type in the active project.
 * When `metaOnly: true` and the index is built, returns metadata from the in-memory
 * index without reading files from disk — O(1) instead of O(n) file reads.
 */
export async function listEntities(entityType, options) {
    // Fast path: use in-memory index when available
    const index = getEntityIndex();
    if (index.isBuilt) {
        let nodes = index.getNodes(entityType);
        // Filter by tags if requested
        if (options?.tags && options.tags.length > 0) {
            const filterTags = options.tags.map(t => t.toLowerCase());
            nodes = nodes.filter(n => {
                const nodeTags = n.tags.map(t => t.toLowerCase());
                return filterTags.some(ft => nodeTags.includes(ft));
            });
        }
        if (options?.metaOnly) {
            // Return index data directly — no disk reads
            return nodes.map(n => ({
                filepath: n.filepath,
                meta: n.meta,
                content: '',
            }));
        }
        // Read full content from disk for matched nodes
        const { storage: stg } = getPlatform();
        const results = [];
        for (const n of nodes) {
            try {
                const rawContent = await stg.readFile(n.filepath, 'utf-8');
                const { meta, content } = parseEntity(n.filepath, rawContent);
                results.push({ filepath: n.filepath, meta, content });
            }
            catch (err) {
                debug('entities', `Index hit but file read failed for ${n.filepath}: ${err}`);
            }
        }
        return results;
    }
    // Fallback: filesystem scan
    const { storage, paths } = getPlatform();
    let dir;
    try {
        dir = await getEntityDir(entityType);
    }
    catch (err) {
        debug('entities', err);
        return [];
    }
    const entities = [];
    try {
        const files = await storage.readdir(dir);
        for (const file of files) {
            if (!file.endsWith('.md') || file.startsWith('.'))
                continue;
            const filepath = paths.join(dir, file);
            const rawContent = await storage.readFile(filepath, 'utf-8');
            const { meta, content } = parseEntity(filepath, rawContent);
            entities.push({ filepath, meta, content });
        }
    }
    catch (err) {
        debug('entities', err);
        // Directory doesn't exist
    }
    // Filter by tags if requested (case-insensitive exact match)
    if (options?.tags && options.tags.length > 0) {
        const filterTags = options.tags.map(t => t.toLowerCase());
        return entities.filter(e => {
            const entityTags = (e.meta.tags ?? []).map(t => t.toLowerCase());
            return filterTags.some(ft => entityTags.includes(ft));
        });
    }
    return entities;
}
