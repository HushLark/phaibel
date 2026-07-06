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
    id: string;
    name: string;              // display name (was: title)
    entityType: EntityTypeName;
    created: string;           // ISO 8601
    updated?: string;          // ISO 8601, set on every save
    description?: string;      // short description / summary (was: summary)
    /** @deprecated use name */
    title?: string;
    /** @deprecated use description */
    summary?: string;
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
 * The one special node in the system: the Person representing the vault owner.
 * It carries a fixed, reserved id (uppercase, so it can never collide with a
 * generated id) — giving "me" a stable, referenceable key (`person:ME000000`)
 * that the relevance layer anchors social/user proximity on.
 */
export const ME_NODE_ID = 'ME000000';

/** Titles that refer to the vault owner — resolved to the me-node on lookup. */
export const ME_ALIASES = new Set(['me', 'myself', 'i', 'self', 'you', 'my', 'owner', 'user']);

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
): EntityMeta {
    return {
        id: generateNodeId(),
        name: title,
        entityType,
        created: new Date().toISOString(),
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
    'name', 'title',            // both accepted; written as 'name'
    'description', 'summary',   // both accepted; written as 'description'
    'created', 'updated',
]);

/**
 * Parse a scalar value string from a body field line.
 * Handles booleans, integers, floats, JSON arrays/objects, and strings.
 */
function parseFieldScalar(raw: string): unknown {
    const v = raw.trim();
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (v === 'null' || v === '~' || v === '') return null;
    if (/^-?\d+$/.test(v)) return parseInt(v, 10);
    if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
    if ((v.startsWith('{') || v.startsWith('[')) ) {
        try { return JSON.parse(v); } catch { /* fall through */ }
    }
    return v;
}

/**
 * Serialize a value for a body field line.
 */
function serializeFieldScalar(value: unknown): string {
    if (typeof value === 'boolean' || typeof value === 'number') return String(value);
    if (typeof value === 'string') return value;
    // Arrays/objects: JSON inline
    return JSON.stringify(value);
}

/**
 * Parse domain fields from the body prefix.
 * Lines at the start matching "key: value" (before the first blank line) are
 * extracted as domain fields; the rest is the user-written content.
 */
export function parseEntityBody(body: string): { fields: Record<string, unknown>; content: string } {
    const lines = body.split('\n');
    const fields: Record<string, unknown> = {};
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
        } else {
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
export function serializeEntityBody(domainFields: Record<string, unknown>, content: string): string {
    const lines: string[] = [];
    for (const [key, value] of Object.entries(domainFields)) {
        if (value === undefined || value === null) continue;
        lines.push(`${key}: ${serializeFieldScalar(value)}`);
    }
    if (lines.length === 0) return content;
    return lines.join('\n') + '\n\n' + content;
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE I/O
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the directory for an entity type in the active project.
 * Reads the entity type config to get the directory name.
 */
export async function getEntityDir(entityType: EntityTypeName): Promise<string> {
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
export async function ensureEntityDir(entityType: EntityTypeName): Promise<string> {
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
export function parseEntity(filepath: string, rawContent: string): { meta: Record<string, unknown>; content: string } {
    const { data, content: rawBody } = matter(rawContent);

    // Normalise legacy field names (title → name, summary → description)
    if (data.title !== undefined && data.name === undefined) {
        data.name = data.title;
    }
    if (data.summary !== undefined && data.description === undefined) {
        data.description = data.summary;
    }
    // Keep title as alias for backward-compat callers
    if (data.name !== undefined) data.title = data.name;

    // Normalise contextType → entityType for internal consumers
    if (data.contextType !== undefined && data.entityType === undefined) {
        data.entityType = data.contextType;
    }

    // Extract domain fields from body prefix (new format)
    const { fields, content } = parseEntityBody(rawBody.trim());

    // Merge: frontmatter wins over body-derived fields for shared keys
    const meta: Record<string, unknown> = { ...fields, ...data };
    meta._filepath = filepath;
    return { meta, content };
}

/**
 * Write an entity to a markdown file using the new simplified-frontmatter format.
 * Core fields (id, name, entityType, description, created, updated) go in
 * YAML frontmatter. All domain fields (status, dueDate, priority, etc.) are
 * written as a key:value block at the top of the body.
 */
export async function writeEntity(
    filepath: string,
    meta: Record<string, unknown>,
    content: string,
): Promise<void> {
    await assertWithinFoundation(filepath);
    // Defensive: never serialize a non-string body (null/undefined would be written
    // as the literal "null"/"undefined"). Coerce to an empty string.
    if (typeof content !== 'string') content = '';
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

    // Write contextType, not entityType, to disk
    if (cleanMeta.entityType !== undefined && cleanMeta.contextType === undefined) {
        cleanMeta.contextType = cleanMeta.entityType;
    }
    delete cleanMeta.entityType;

    // Separate core (frontmatter) from domain (body)
    const frontmatter: Record<string, unknown> = {};
    const domainFields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(cleanMeta)) {
        if (value === undefined) continue;
        if (CORE_FRONTMATTER_KEYS.has(key)) {
            frontmatter[key] = value;
        } else {
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
export async function trashEntity(filepath: string): Promise<string> {
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
    } catch {
        // No collision — use original name
    }

    await storage.rename(filepath, trashPath);
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
    const { storage, paths } = getPlatform();
    // Fast path: use in-memory index if built
    const index = getEntityIndex();
    if (index.isBuilt) {
        // "Me" aliases always resolve to the one special node (the vault owner),
        // so relationships like "my wife → me" link cleanly even when the user is
        // referenced as "me"/"you"/"self" rather than by name.
        if (entityType === 'person' && ME_ALIASES.has(titleOrFilename.trim().toLowerCase())) {
            const meNode = index.getMeNode();
            if (meNode) {
                try {
                    const rawContent = await storage.readFile(meNode.filepath, 'utf-8');
                    const { meta, content } = parseEntity(meNode.filepath, rawContent);
                    return { filepath: meNode.filepath, meta, content };
                } catch (err) {
                    debug('entities', `Me-node read failed: ${err}`);
                }
            }
        }

        const node = index.findByTitle(entityType, titleOrFilename);
        if (node) {
            try {
                const rawContent = await storage.readFile(node.filepath, 'utf-8');
                const { meta, content } = parseEntity(node.filepath, rawContent);
                return { filepath: node.filepath, meta, content };
            } catch (err) {
                debug('entities', `Index hit but file read failed: ${err}`);
            }
        }

        // Semantic fallback: try embedding similarity search.
        // This is an identity lookup, not relevance ranking — a weak match here
        // returns the WRONG entity (create sees a false "already exists"; update
        // writes onto it). The index's own floor (0.25, tuned for paraphrase
        // retrieval where a combiner weighs the score) admitted "Jeremy"→"gary"
        // at 0.42 and serially renamed the ME node. Require near-identity.
        const TITLE_LOOKUP_MIN_SIMILARITY = 0.6;
        const embeddingIndex = getEmbeddingIndex();
        if (embeddingIndex.isLoaded) {
            try {
                const results = await embeddingIndex.search(titleOrFilename, 1, entityType);
                if (results.length > 0 && results[0].similarity >= TITLE_LOOKUP_MIN_SIMILARITY) {
                    const matchedNode = index.getNode(results[0].key);
                    if (matchedNode) {
                        debug('entities', `Semantic match for "${titleOrFilename}" → "${matchedNode.title}" (similarity: ${results[0].similarity.toFixed(3)})`);
                        const rawContent = await storage.readFile(matchedNode.filepath, 'utf-8');
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
        const files = await storage.readdir(dir);
        const needle = titleOrFilename.toLowerCase();
        let partialMatch: { filepath: string; meta: Record<string, unknown>; content: string } | null = null;

        for (const file of files) {
            if (!file.endsWith('.md') || file.startsWith('.')) continue;

            const filepath = paths.join(dir, file);
            const rawContent = await storage.readFile(filepath, 'utf-8');
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
 * Hierarchy-aware lookup: resolve a node by title across the context-type tree.
 * Tries the preferred type first, then its siblings/subtypes (same baseCategory
 * or whose parent-chain includes it), then every other type. This is what lets a
 * lookup for a "person" still find a node that was moved to a subtype like
 * "family" — a plain `findEntityByTitle(preferredType, …)` only searches one type.
 * Returns the match plus the type it was actually found in.
 */
export async function findNodeAnyType(
    titleOrFilename: string,
    preferredType?: string,
): Promise<{ filepath: string; meta: Record<string, unknown>; content: string; entityType: string } | null> {
    const types = await loadEntityTypes();
    const byName = new Map(types.map(t => [t.name, t]));
    const pref = preferredType ? byName.get(preferredType) : undefined;

    // A type is "near" the preferred one if it shares its base category or its
    // parent-chain leads to it (so person ↔ family/friend/colleague are neighbors).
    const isNear = (t: { name: string; parent?: string; baseCategory?: string }): boolean => {
        if (!pref) return false;
        if (t.name === pref.name) return true;
        if (t.baseCategory && pref.baseCategory && t.baseCategory === pref.baseCategory) return true;
        let cur: typeof t | undefined = t; const seen = new Set<string>();
        while (cur?.parent && !seen.has(cur.name)) { seen.add(cur.name); if (cur.parent === pref.name) return true; cur = byName.get(cur.parent); }
        return false;
    };

    // Search order: preferred → near types → everything else.
    const order: string[] = [];
    const push = (n: string) => { if (!order.includes(n)) order.push(n); };
    if (preferredType && byName.has(preferredType)) push(preferredType);
    for (const t of types) if (isNear(t)) push(t.name);
    for (const t of types) push(t.name);

    for (const typeName of order) {
        const found = await findEntityByTitle(typeName as EntityTypeName, titleOrFilename).catch(() => null);
        if (found) return { ...found, entityType: typeName };
    }
    return null;
}

/**
 * Full-text search across entities by title, summary, and body content.
 * Tokenizes query into words and scores matches: title=3pts, summary=1pt,
 * body=1pt per token. Only returns entities where ALL tokens match at least
 * one field. Semantic (embedding) similarity is merged in when available.
 */
export async function searchEntities(
    query: string,
    entityType?: EntityTypeName,
): Promise<{ filepath: string; meta: Record<string, unknown>; content: string; score: number }[]> {
    // Fast path: use in-memory index if built
    const index = getEntityIndex();
    if (index.isBuilt) {
        // 1. Keyword search via entity index
        const keywordResults = index.search(query, entityType);

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
        const { storage } = getPlatform();
        const results: { filepath: string; meta: Record<string, unknown>; content: string; score: number }[] = [];
        for (const { node, score } of sorted) {
            try {
                const rawContent = await storage.readFile(node.filepath, 'utf-8');
                const { meta, content } = parseEntity(node.filepath, rawContent);
                results.push({ filepath: node.filepath, meta, content, score });
            } catch (err) {
                debug('entities', `Index hit but file read failed for ${node.filepath}: ${err}`);
            }
        }
        return results;
    }

    // Fallback: filesystem scan
    const searchTokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (searchTokens.length === 0) return [];

    // Gather all entities to search
    let allEntities: { filepath: string; meta: Record<string, unknown>; content: string }[];

    if (entityType) {
        allEntities = await listEntities(entityType);
    } else {
        const types = await loadEntityTypes();
        const lists = await Promise.all(types.map(t => listEntities(t.name)));
        allEntities = lists.flat();
    }

    const results: { filepath: string; meta: Record<string, unknown>; content: string; score: number }[] = [];

    for (const entity of allEntities) {
        const title = ((entity.meta.title as string) ?? '').toLowerCase();
        const body = entity.content.toLowerCase();

        let score = 0;
        let allMatched = true;

        for (const token of searchTokens) {
            let matched = false;
            if (title.includes(token)) { score += 3; matched = true; }
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
    options?: { metaOnly?: boolean },
): Promise<{ filepath: string; meta: Record<string, unknown>; content: string }[]> {
    // Fast path: use in-memory index when available
    const index = getEntityIndex();
    if (index.isBuilt) {
        const nodes = index.getNodes(entityType);

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
        const results: { filepath: string; meta: Record<string, unknown>; content: string }[] = [];
        for (const n of nodes) {
            try {
                const rawContent = await stg.readFile(n.filepath, 'utf-8');
                const { meta, content } = parseEntity(n.filepath, rawContent);
                results.push({ filepath: n.filepath, meta, content });
            } catch (err) {
                debug('entities', `Index hit but file read failed for ${n.filepath}: ${err}`);
            }
        }
        return results;
    }

    // Fallback: filesystem scan
    const { storage, paths } = getPlatform();
    let dir: string;
    try {
        dir = await getEntityDir(entityType);
    } catch (err) {
        debug('entities', err);
        return [];
    }

    const entities: { filepath: string; meta: Record<string, unknown>; content: string }[] = [];

    try {
        const files = await storage.readdir(dir);

        for (const file of files) {
            if (!file.endsWith('.md') || file.startsWith('.')) continue;

            const filepath = paths.join(dir, file);
            const rawContent = await storage.readFile(filepath, 'utf-8');
            const { meta, content } = parseEntity(filepath, rawContent);

            entities.push({ filepath, meta, content });
        }
    } catch (err) {
        debug('entities', err);
        // Directory doesn't exist
    }

    return entities;
}
