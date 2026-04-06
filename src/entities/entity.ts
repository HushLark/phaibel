// ─────────────────────────────────────────────────────────────────────────────
// ENTITY MODEL
// All records are Entities — markdown files with gray-matter frontmatter.
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { debug } from '../utils/debug.js';
import { getVaultRoot } from '../state/manager.js';
import { getEntityType, loadEntityTypes } from './entity-type-config.js';
import { getEntityIndex } from './entity-index.js';
import { getEmbeddingIndex } from './embedding-index.js';
import { assertWithinFoundation } from '../cxms/boundary-guard.js';

// ─────────────────────────────────────────────────────────────────────────────
// SHARED TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Any registered entity type name. Validated at runtime via entity-type-config. */
export type EntityTypeName = string;

/** A named link stored in YAML frontmatter to express a labeled relationship. */
export interface EntityLink {
    target: string;   // "type:id" composite key
    label: string;    // relationship name
}

/** @deprecated Use EntityTypeName (string) — kept for callers that rely on the union */
export type BuiltInEntityTypeName = 'note' | 'task' | 'event' | 'research' | 'goal' | 'recurrence' | 'person' | 'todont';

export type TaskStatus = 'open' | 'in-progress' | 'done' | 'blocked';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export type GoalStatus = 'active' | 'completed' | 'paused' | 'abandoned';
export type GoalPriority = 'low' | 'medium' | 'high';

export type ResearchStatus = 'draft' | 'in-progress' | 'complete';

export type EventRecurrence = 'daily' | 'weekly' | 'monthly' | 'yearly';

export type RecurrenceCadence = 'daily' | 'weekly' | 'monthly';
export type RecurrenceTargetType = 'todo' | 'event';

export interface BlackoutWindow {
    start: string;         // YYYY-MM-DD
    end: string;           // YYYY-MM-DD
    reason?: string;
}

export interface CadenceDetails {
    dayOfMonth?: number;   // 1–31 for monthly
    dayOfWeek?: string;    // e.g. 'monday' for weekly
    startTime?: string;    // HH:mm for events
    endTime?: string;      // HH:mm for events
    location?: string;     // events only
}

// ─────────────────────────────────────────────────────────────────────────────
// BASE ENTITY (shared by all)
// ─────────────────────────────────────────────────────────────────────────────

export interface EntityMeta {
    id: string;                // e.g. "task-abc123" — type prefix + 6 base-36 chars
    title: string;
    entityType: EntityTypeName;
    created: string;           // ISO 8601
    updated?: string;          // ISO 8601, set on every save
    tags: string[];
    summary?: string;          // LLM-generated one-sentence summary (max 150 chars)
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTITY-SPECIFIC TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Note — base only, no extra fields */
export interface NoteEntity extends EntityMeta {
    entityType: 'note';
}

/** Task — actionable item with due date */
export interface TaskEntity extends EntityMeta {
    entityType: 'task';
    status: TaskStatus;
    priority: TaskPriority;
    dueDate?: string;          // YYYY-MM-DD
    focusTime?: string;        // hours of actual work, e.g. "4h", "30m", "2d"
    calendarDays?: number;     // elapsed days the work spans
    startDate?: string;        // YYYY-MM-DD — when work begins
}

/** Event — has start and end datetimes */
export interface EventEntity extends EntityMeta {
    entityType: 'event';
    startDate: string;         // ISO 8601 datetime
    endDate: string;           // ISO 8601 datetime
    location?: string;
    recurring?: EventRecurrence;
}

/** Research — tracked investigation */
export interface ResearchEntity extends EntityMeta {
    entityType: 'research';
    status: ResearchStatus;
    sources: string[];
}

/** SMART Goal */
export interface SmartFields {
    specific: string;          // What exactly will you accomplish?
    measurable: string;        // How will you measure success?
    achievable: string;        // Is this realistic?
    relevant: string;          // Why does this matter?
    timeBound: string;         // Target date YYYY-MM-DD
}

export interface GoalEntity extends EntityMeta {
    entityType: 'goal';
    status: GoalStatus;
    priority: GoalPriority;
    smart: Partial<SmartFields>;
    milestones: string[];
}

/** Recurrence — template for generating concrete todos or events */
export interface RecurrenceEntity extends EntityMeta {
    entityType: 'recurrence';
    recurrenceType: RecurrenceTargetType;
    cadence: RecurrenceCadence;
    cadenceDetails: CadenceDetails;
    priority?: string;        // todo-only default priority
    blackoutWindows?: BlackoutWindow[];
}

/** Person — contact with company/group/handle info */
export interface PersonEntity extends EntityMeta {
    entityType: 'person';
    company?: string;
    group?: string;
    phone?: string;
    email?: string;
    handle?: string;           // Slack, Teams, or work management handle
}

/** Discriminated union of all entity types */
export type Entity = NoteEntity | TaskEntity | EventEntity | ResearchEntity | GoalEntity | RecurrenceEntity | PersonEntity;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a unique node id: 8 lowercase alphanumeric characters.
 * e.g. "a1b2c3d4", "x9y8z7w6"
 */
export function generateNodeId(): string {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
    let id = '';
    // First char must be alpha per system naming rules
    const alpha = 'abcdefghijklmnopqrstuvwxyz';
    id += alpha[Math.floor(Math.random() * 26)];
    for (let i = 1; i < 8; i++) id += chars[Math.floor(Math.random() * 36)];
    return id;
}

/** @deprecated Use generateNodeId() */
export function generateEntityId(_typeName: string): string {
    return generateNodeId();
}

/**
 * Slugify a title into a URL/filename-safe hyphenated string.
 * Follows system naming rules: lowercase, alphanumeric, hyphens for spaces.
 */
export function slugify(title: string): string {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

/**
 * Build a filename for a context node: `{slug}_{id}.md`
 * e.g. "Fix the Plumbing" + "a1b2c3d4" → "fix-the-plumbing_a1b2c3d4.md"
 */
export function nodeFilename(title: string, id: string): string {
    const slug = slugify(title);
    return `${slug}_${id}.md`;
}

/** @deprecated Use nodeFilename() */
export function entityFilename(title: string, id: string): string {
    return nodeFilename(title, id);
}

/**
 * Create base entity metadata with defaults.
 */
export function createEntityMeta(
    entityType: EntityTypeName,
    title: string,
    opts: { tags?: string[] } = {},
): EntityMeta {
    return {
        id: generateNodeId(),
        title,
        entityType,
        created: new Date().toISOString(),
        tags: opts.tags ?? [],
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE I/O
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the directory for an entity type in the active project.
 * Reads the entity type config to get the directory name.
 */
export async function getEntityDir(entityType: EntityTypeName): Promise<string> {
    const vaultRoot = await getVaultRoot();
    const typeConfig = await getEntityType(entityType);
    if (!typeConfig) {
        throw new Error(`Unknown entity type: "${entityType}". Check ~/.phaibel/entity-types.json.`);
    }
    return path.join(vaultRoot, typeConfig.directory);
}

/**
 * Ensure the entity directory exists, return its path.
 */
export async function ensureEntityDir(entityType: EntityTypeName): Promise<string> {
    const dir = await getEntityDir(entityType);
    await fs.mkdir(dir, { recursive: true });
    return dir;
}

/**
 * Parse a markdown file into an Entity (frontmatter + body content).
 */
export function parseEntity(filepath: string, rawContent: string): { meta: Record<string, unknown>; content: string } {
    const { data, content } = matter(rawContent);
    // Ensure filepath is available for callers
    data._filepath = filepath;
    return { meta: data, content: content.trim() };
}

/**
 * Write an entity to a markdown file with frontmatter.
 * Sets `updated` timestamp automatically.
 */
export async function writeEntity(
    filepath: string,
    meta: Record<string, unknown>,
    content: string,
): Promise<void> {
    await assertWithinFoundation(filepath);
    // Always update the timestamp on write
    meta.updated = new Date().toISOString();
    // Remove internal fields
    const cleanMeta = { ...meta };
    delete cleanMeta._filepath;
    // Strip undefined values — js-yaml can't serialize them
    for (const key of Object.keys(cleanMeta)) {
        if (cleanMeta[key] === undefined) {
            delete cleanMeta[key];
        }
    }
    const fileContent = matter.stringify(content, cleanMeta);
    await fs.writeFile(filepath, fileContent);
}

/**
 * Move an entity file to the trash instead of permanently deleting it.
 * Trash location: <vaultRoot>/.trash/<entity-dir>/<filename>
 * If a file with the same name exists in trash, appends a timestamp.
 */
export async function trashEntity(filepath: string): Promise<string> {
    await assertWithinFoundation(filepath);
    const vaultRoot = await getVaultRoot();
    const trashRoot = path.join(vaultRoot, '.trash');

    // Derive the entity subdirectory from the filepath
    // e.g. ~/.phaibel/projects/work/todos/foo.md → todos
    const parentDir = path.basename(path.dirname(filepath));
    const trashDir = path.join(trashRoot, parentDir);

    await fs.mkdir(trashDir, { recursive: true });

    const filename = path.basename(filepath);
    let trashPath = path.join(trashDir, filename);

    // Avoid collisions — append timestamp if file already exists in trash
    try {
        await fs.access(trashPath);
        const stem = path.basename(filename, '.md');
        const ts = Date.now();
        trashPath = path.join(trashDir, `${stem}-${ts}.md`);
    } catch {
        // No collision — use original name
    }

    await fs.rename(filepath, trashPath);
    debug('entities', `Trashed ${filepath} → ${trashPath}`);
    return trashPath;
}

/**
 * Find an entity by title or filename within a directory.
 */
export async function findEntityByTitle(
    entityType: EntityTypeName,
    titleOrFilename: string,
): Promise<{ filepath: string; meta: Record<string, unknown>; content: string } | null> {
    // Fast path: use in-memory index if built
    const index = getEntityIndex();
    if (index.isBuilt) {
        const node = index.findByTitle(entityType, titleOrFilename);
        if (node) {
            try {
                const rawContent = await fs.readFile(node.filepath, 'utf-8');
                const { meta, content } = parseEntity(node.filepath, rawContent);
                return { filepath: node.filepath, meta, content };
            } catch (err) {
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
                        const rawContent = await fs.readFile(matchedNode.filepath, 'utf-8');
                        const { meta, content } = parseEntity(matchedNode.filepath, rawContent);
                        return { filepath: matchedNode.filepath, meta, content };
                    }
                }
            } catch (err) {
                debug('entities', `Semantic search failed: ${err}`);
            }
        }

        return null;
    }

    // Fallback: filesystem scan
    let dir: string;
    try {
        dir = await getEntityDir(entityType);
    } catch (err) {
        debug('entities', err);
        return null;
    }
    try {
        const files = await fs.readdir(dir);
        const needle = titleOrFilename.toLowerCase();
        let partialMatch: { filepath: string; meta: Record<string, unknown>; content: string } | null = null;

        for (const file of files) {
            if (!file.endsWith('.md') || file.startsWith('.')) continue;

            const filepath = path.join(dir, file);
            const rawContent = await fs.readFile(filepath, 'utf-8');
            const { meta, content } = parseEntity(filepath, rawContent);

            // Exact match on id or title — return immediately
            if (
                meta.id === titleOrFilename ||
                (meta.title && (meta.title as string).toLowerCase() === needle)
            ) {
                return { filepath, meta, content };
            }

            // Partial match — title contains search term or vice versa
            if (!partialMatch && meta.title) {
                const titleLower = (meta.title as string).toLowerCase();
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
    } catch (err) {
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
export async function searchEntities(
    query: string,
    entityType?: EntityTypeName,
    options?: { tags?: string[] },
): Promise<{ filepath: string; meta: Record<string, unknown>; content: string; score: number }[]> {
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
        const mergedScores = new Map<string, { node: typeof keywordResults[0]['node']; score: number }>();

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
                    } else {
                        // Semantic-only hit — find node from index
                        const node = index.getNode(key);
                        if (node) {
                            mergedScores.set(key, { node, score: similarity * 0.4 });
                        }
                    }
                }
            } catch (err) {
                debug('entities', `Semantic search failed, using keyword-only: ${err}`);
            }
        }

        // Sort by combined score descending
        const sorted = [...mergedScores.values()].sort((a, b) => b.score - a.score);

        // Read full content from disk for matched nodes
        const results: { filepath: string; meta: Record<string, unknown>; content: string; score: number }[] = [];
        for (const { node, score } of sorted) {
            try {
                const rawContent = await fs.readFile(node.filepath, 'utf-8');
                const { meta, content } = parseEntity(node.filepath, rawContent);
                results.push({ filepath: node.filepath, meta, content, score });
            } catch (err) {
                debug('entities', `Index hit but file read failed for ${node.filepath}: ${err}`);
            }
        }
        return results;
    }

    // Fallback: filesystem scan
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

    // Merge inline tag: tokens with explicit tags option
    const allFilterTags = [...tagTokens, ...(options?.tags ?? []).map(t => t.toLowerCase())];

    if (searchTokens.length === 0 && allFilterTags.length === 0) return [];

    // Gather all entities to search
    let allEntities: { filepath: string; meta: Record<string, unknown>; content: string }[];

    if (entityType) {
        allEntities = await listEntities(entityType);
    } else {
        const types = await loadEntityTypes();
        const lists = await Promise.all(types.map(t => listEntities(t.name)));
        allEntities = lists.flat();
    }

    // Pre-filter by tags if any tag filters are specified
    if (allFilterTags.length > 0) {
        allEntities = allEntities.filter(e => {
            const entityTags = ((e.meta.tags as string[]) ?? []).map(t => t.toLowerCase());
            return allFilterTags.some(ft => entityTags.includes(ft));
        });
    }

    // If no search tokens, return all tag-matched entities with score 1
    if (searchTokens.length === 0) {
        return allEntities.map(e => ({ filepath: e.filepath, meta: e.meta, content: e.content, score: 1 }));
    }

    const results: { filepath: string; meta: Record<string, unknown>; content: string; score: number }[] = [];

    for (const entity of allEntities) {
        const title = ((entity.meta.title as string) ?? '').toLowerCase();
        const tags = ((entity.meta.tags as string[]) ?? []).map(t => t.toLowerCase());
        const body = entity.content.toLowerCase();

        let score = 0;
        let allMatched = true;

        for (const token of searchTokens) {
            let matched = false;
            if (title.includes(token)) { score += 3; matched = true; }
            if (tags.some(tag => tag.includes(token))) { score += 2; matched = true; }
            if (body.includes(token)) { score += 1; matched = true; }
            if (!matched) { allMatched = false; break; }
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
export async function listEntities(
    entityType: EntityTypeName,
    options?: { tags?: string[]; metaOnly?: boolean },
): Promise<{ filepath: string; meta: Record<string, unknown>; content: string }[]> {
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
        const results: { filepath: string; meta: Record<string, unknown>; content: string }[] = [];
        for (const n of nodes) {
            try {
                const rawContent = await fs.readFile(n.filepath, 'utf-8');
                const { meta, content } = parseEntity(n.filepath, rawContent);
                results.push({ filepath: n.filepath, meta, content });
            } catch (err) {
                debug('entities', `Index hit but file read failed for ${n.filepath}: ${err}`);
            }
        }
        return results;
    }

    // Fallback: filesystem scan
    let dir: string;
    try {
        dir = await getEntityDir(entityType);
    } catch (err) {
        debug('entities', err);
        return [];
    }

    const entities: { filepath: string; meta: Record<string, unknown>; content: string }[] = [];

    try {
        const files = await fs.readdir(dir);

        for (const file of files) {
            if (!file.endsWith('.md') || file.startsWith('.')) continue;

            const filepath = path.join(dir, file);
            const rawContent = await fs.readFile(filepath, 'utf-8');
            const { meta, content } = parseEntity(filepath, rawContent);

            entities.push({ filepath, meta, content });
        }
    } catch (err) {
        debug('entities', err);
        // Directory doesn't exist
    }

    // Filter by tags if requested (case-insensitive exact match)
    if (options?.tags && options.tags.length > 0) {
        const filterTags = options.tags.map(t => t.toLowerCase());
        return entities.filter(e => {
            const entityTags = ((e.meta.tags as string[]) ?? []).map(t => t.toLowerCase());
            return filterTags.some(ft => entityTags.includes(ft));
        });
    }

    return entities;
}
