// ─────────────────────────────────────────────────────────────────────────────
// CxMS — Context Type Store
// ─────────────────────────────────────────────────────────────────────────────
// Manages context types stored in (Foundation)/context-types/ directories.
// Each type has its own directory with .phaibel.md (config) and
// .phaibel-examples.md (usage examples).
//
// Falls back to legacy entity-types.json if context-types/ doesn't exist.
// ─────────────────────────────────────────────────────────────────────────────

import { getPlatform } from '../platform/index.js';
import matter from 'gray-matter';
import { getContextTypesDir, getContextTypeMappingPath } from '../paths.js';
import { findFoundationRoot } from '../state/manager.js';
import { debug } from '../utils/debug.js';
import type { EntityTypeConfig, FieldDef } from '../entities/entity-type-config.js';

// ── Mapping index ────────────────────────────────────────────────────────────

interface ContextTypeMapping {
    version: number;
    types: Array<{
        name: string;
        plural: string;
        directory: string;
    }>;
}

// ── Read ─────────────────────────────────────────────────────────────────────

/**
 * Load all context types by scanning context-types/ directories.
 * Each subdirectory with a .phaibel.md is a context type.
 * Returns EntityTypeConfig[] for backward compatibility.
 */
export async function loadContextTypesFromStore(): Promise<EntityTypeConfig[] | null> {
    const root = await findFoundationRoot();
    if (!root) return null;

    const { storage, paths } = getPlatform();
    const ctDir = paths.join(root, 'context-types');
    try {
        const entries = await storage.readdir(ctDir);
        const types: EntityTypeConfig[] = [];

        for (const entry of entries) {
            // Check if entry is a directory
            try {
                const st = await storage.stat(paths.join(ctDir, entry));
                if (!st.isDirectory) continue;
            } catch { continue; }

            // Try .cxms.md first, fall back to .phaibel.md
            let raw: string | null = null;
            for (const marker of ['.cxms.md', '.phaibel.md']) {
                try {
                    raw = await storage.readFile(paths.join(ctDir, entry, marker));
                    break;
                } catch { /* try next */ }
            }
            try {
                if (!raw) throw new Error('no context file');
                const { data } = matter(raw);
                const config = data as EntityTypeConfig;
                // Ensure directory is set correctly
                config.directory = `context-types/${entry}`;
                if (!config.name) config.name = entry;
                if (!config.fields) config.fields = [];
                types.push(config);
            } catch {
                // Skip directories without .phaibel.md
            }
        }

        if (types.length === 0) return null; // Not yet initialized
        return types;
    } catch {
        return null; // context-types/ doesn't exist yet
    }
}

// ── Write ────────────────────────────────────────────────────────────────────

/**
 * Write a context type to its directory.
 * Creates (Foundation)/context-types/{name}/.phaibel.md and .phaibel-examples.md.
 */
export async function writeContextType(config: EntityTypeConfig): Promise<void> {
    const root = await findFoundationRoot();
    if (!root) throw new Error('No foundation found');

    const { storage, paths } = getPlatform();
    const typeDir = paths.join(root, 'context-types', config.name);
    await storage.mkdir(typeDir, { recursive: true });

    // Write .phaibel.md — type schema and description
    const fieldLines = config.fields.map(f => {
        let desc = `- **${f.key}** (${f.type})`;
        if (f.label) desc += ` — ${f.label}`;
        if (f.type === 'enum' && f.values) desc += `: ${f.values.join(', ')}`;
        if (f.default !== undefined) desc += ` [default: ${f.default}]`;
        if (f.required) desc += ` *required*`;
        return desc;
    });

    const completionNote = config.completionField
        ? `\nCompletion: set \`${config.completionField}\` to \`${config.completionValue ?? 'done'}\` to mark as complete.\n`
        : '';

    const body = `# ${config.plural.charAt(0).toUpperCase() + config.plural.slice(1)}

${config.description || `A collection of ${config.plural}.`}

## Fields

${fieldLines.length > 0 ? fieldLines.join('\n') : '_No custom fields defined._'}
${completionNote}
## Guidelines

- Use the exact field names above when creating or updating ${config.plural}.
- Titles should be concise and descriptive.
- When the user refers to "${config.plural}" or "${config.name}", this is the context type to use.
`;

    // Store the full config in frontmatter, body is the human-readable description
    const meta: Record<string, unknown> = {
        name: config.name,
        plural: config.plural,
        directory: `context-types/${config.name}`,
        description: config.description,
        fields: config.fields,
    };
    if (config.defaultTags) meta.defaultTags = config.defaultTags;
    if (config.completionField) meta.completionField = config.completionField;
    if (config.completionValue) meta.completionValue = config.completionValue;
    if (config.spawner) meta.spawner = config.spawner;
    if (config.calendarDateField) meta.calendarDateField = config.calendarDateField;

    const phaibelMd = matter.stringify(body, meta);
    await storage.writeFile(paths.join(typeDir, '.cxms.md'), phaibelMd);

    // Write .phaibel-examples.md if it doesn't exist
    const examplesPath = paths.join(typeDir, '.cxms-examples.md');
    try {
        await storage.access(examplesPath);
    } catch {
        const examples = generateExamples(config);
        await storage.writeFile(examplesPath, examples);
    }

    debug('context-type-store', `Wrote context type: ${config.name}`);
}

/**
 * Write the mapping.json index file listing all context types.
 */
export async function writeMappingIndex(types: EntityTypeConfig[]): Promise<void> {
    const mappingPath = await getContextTypeMappingPath();
    const mapping: ContextTypeMapping = {
        version: 1,
        types: types.map(t => ({
            name: t.name,
            plural: t.plural,
            directory: `context-types/${t.name}`,
        })),
    };
    await getPlatform().storage.writeFile(mappingPath, JSON.stringify(mapping, null, 2));
}

/**
 * Write all context types to their directories and update the mapping index.
 */
export async function writeAllContextTypes(types: EntityTypeConfig[]): Promise<void> {
    const ctDir = await getContextTypesDir();
    await getPlatform().storage.mkdir(ctDir, { recursive: true });

    for (const t of types) {
        await writeContextType(t);
    }
    await writeMappingIndex(types);
}

/**
 * Remove a context type directory.
 */
export async function removeContextTypeDir(name: string): Promise<void> {
    const root = await findFoundationRoot();
    if (!root) throw new Error('No foundation found');
    const { storage, paths } = getPlatform();
    const typeDir = paths.join(root, 'context-types', name);
    // Remove all files in the directory, then the directory itself
    try {
        const entries = await storage.readdir(typeDir);
        for (const entry of entries) {
            await storage.unlink(paths.join(typeDir, entry));
        }
        // Remove the now-empty directory by unlinking it
        await storage.unlink(typeDir);
    } catch {
        // Directory doesn't exist — nothing to remove
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateExamples(config: EntityTypeConfig): string {
    const lines = [`# ${config.name} — Examples`, '', `Example ${config.plural} for reference:`, ''];

    if (config.name === 'task') {
        lines.push('## Example: Buy Groceries', '', '```yaml', 'title: Buy Groceries',
            'status: open', 'priority: medium', 'dueDate: 2026-04-10', '```', '');
    } else if (config.name === 'event') {
        lines.push('## Example: Team Meeting', '', '```yaml', 'title: Team Meeting',
            'startDate: 2026-04-10T14:00:00Z', 'endDate: 2026-04-10T15:00:00Z',
            'location: Conference Room A', '```', '');
    } else if (config.name === 'note') {
        lines.push('## Example: Project Ideas', '', '```yaml', 'title: Project Ideas',
            'tags: [ideas, brainstorm]', '```', '',
            'Body content goes here in Markdown.', '');
    } else {
        lines.push(`_Add examples of ${config.plural} here._`, '');
    }

    return lines.join('\n');
}
