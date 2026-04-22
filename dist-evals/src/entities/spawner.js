// ─────────────────────────────────────────────────────────────────────────────
// SPAWNER — Generic engine for entities that generate child entities
//
// Supports two modes:
//   date-series  — generates one child per occurrence date (like recurrences)
//   template     — spawns a fixed set of children once
// ─────────────────────────────────────────────────────────────────────────────
import matter from 'gray-matter';
import { getPlatform } from '../platform/index.js';
import { generateEntityId, writeEntity, ensureEntityDir, entityFilename } from './entity.js';
import { getEntityType } from './entity-type-config.js';
import { getEntityIndex } from './entity-index.js';
import { debug } from '../utils/debug.js';
// ─────────────────────────────────────────────────────────────────────────────
// DATE UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
const DAYS_OF_WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
/**
 * Compute all occurrence dates within [start, end] for daily/weekly/monthly cadences.
 */
export function computeOccurrences(cadence, details, start, end) {
    const dates = [];
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    switch (cadence) {
        case 'daily': {
            while (cursor <= end) {
                dates.push(new Date(cursor));
                cursor.setDate(cursor.getDate() + 1);
            }
            break;
        }
        case 'weekly': {
            const targetDay = DAYS_OF_WEEK.indexOf((details.dayOfWeek ?? 'monday').toLowerCase());
            while (cursor.getDay() !== targetDay && cursor <= end) {
                cursor.setDate(cursor.getDate() + 1);
            }
            while (cursor <= end) {
                dates.push(new Date(cursor));
                cursor.setDate(cursor.getDate() + 7);
            }
            break;
        }
        case 'monthly': {
            const targetDom = details.dayOfMonth ?? 1;
            cursor.setDate(targetDom);
            if (cursor < start) {
                cursor.setMonth(cursor.getMonth() + 1);
                cursor.setDate(targetDom);
            }
            while (cursor <= end) {
                dates.push(new Date(cursor));
                cursor.setMonth(cursor.getMonth() + 1);
                cursor.setDate(targetDom);
            }
            break;
        }
    }
    return dates;
}
/**
 * Returns true if the date falls inside any blackout window.
 */
export function isBlackedOut(date, windows) {
    const d = formatDate(date);
    return windows.some(w => d >= w.start && d <= w.end);
}
/**
 * Interpolate a title pattern like "{title} — {YYYY-MM-DD}" for a given date.
 */
export function interpolateTitlePattern(pattern, title, date) {
    return pattern
        .replace('{title}', title)
        .replace('{YYYY-MM-DD}', formatDate(date));
}
/**
 * Build child entity fields from a FieldMapping array.
 * Tokens: {date} → YYYY-MM-DD string, {title} → template title
 */
export function applyFieldMapping(mappings, template, date) {
    const result = {};
    if (!mappings)
        return result;
    const dateStr = date ? formatDate(date) : '';
    for (const m of mappings) {
        const targetKey = m.to ?? m.target;
        if (!targetKey)
            continue;
        if (m.from) {
            // Copy value from template field
            const val = template.meta[m.from];
            result[targetKey] = val !== undefined ? val : m.default;
        }
        else if (m.value !== undefined) {
            // Literal value or token substitution
            const raw = String(m.value);
            result[targetKey] = raw
                .replace('{date}', dateStr)
                .replace('{title}', String(template.meta.title ?? ''))
                .replace('{YYYY-MM-DD}', dateStr);
        }
    }
    return result;
}
// ─────────────────────────────────────────────────────────────────────────────
// DATE-SERIES SPAWNER
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Generate child entities for a date-series spawner (e.g. recurrence).
 * Creates one child per occurrence date within [startDate, endDate].
 * Idempotent: skips already-created children based on dedupeFields.
 */
export async function spawnDateSeries(template, spawnerConfig, targetTypeConfig, startDate, endDate) {
    const scheduling = spawnerConfig.scheduling;
    if (!scheduling)
        throw new Error('date-series spawner requires scheduling config');
    const cadence = template.meta[scheduling.cadenceField] ?? 'monthly';
    const rawDetails = template.meta[scheduling.cadenceDetailsField];
    const cadenceDetails = (rawDetails && typeof rawDetails === 'object' && !Array.isArray(rawDetails)) ? rawDetails : {};
    const rawBlackout = template.meta[scheduling.blackoutField];
    const blackoutWindows = Array.isArray(rawBlackout) ? rawBlackout : [];
    const occurrences = computeOccurrences(cadence, cadenceDetails, startDate, endDate);
    const { storage, paths } = getPlatform();
    const targetDir = await ensureEntityDir(targetTypeConfig.name);
    // Load existing entities for dedup check
    const existingFiles = await safeReaddir(targetDir);
    const existingMetas = await Promise.all(existingFiles.filter(f => f.endsWith('.md')).map(async (f) => {
        const raw = await storage.readFile(paths.join(targetDir, f), 'utf-8');
        return matter(raw).data;
    }));
    const titlePattern = spawnerConfig.titlePattern ?? '{title} — {YYYY-MM-DD}';
    const dedupeFields = spawnerConfig.dedupeFields ?? [];
    const templateTitle = String(template.meta.title ?? '');
    let created = 0;
    let skipped = 0;
    for (const date of occurrences) {
        if (isBlackedOut(date, blackoutWindows)) {
            skipped++;
            continue;
        }
        const dateStr = formatDate(date);
        const childTitle = interpolateTitlePattern(titlePattern, templateTitle, date);
        // Idempotency check using dedupeFields
        if (dedupeFields.length > 0) {
            const mappedFields = applyFieldMapping(spawnerConfig.fieldMapping, template, date);
            // Include the computed title so dedup can match on it
            const candidateFields = { title: childTitle, ...mappedFields };
            const alreadyExists = existingMetas.some(m => dedupeFields.every(f => m[f] === candidateFields[f]));
            if (alreadyExists) {
                skipped++;
                continue;
            }
        }
        const id = generateEntityId(targetTypeConfig.name);
        const filepath = paths.join(targetDir, entityFilename(childTitle, id));
        // Build child meta
        const childMeta = {
            id,
            title: childTitle,
            entityType: targetTypeConfig.name,
            created: new Date().toISOString(),
            tags: [...(targetTypeConfig.defaultTags ?? []), 'recurring'],
            ...applyFieldMapping(spawnerConfig.fieldMapping, template, date),
        };
        // For event targets: attach times from cadenceDetails if available
        if (targetTypeConfig.name === 'event' && (cadenceDetails.startTime || cadenceDetails.endTime)) {
            const startTime = cadenceDetails.startTime ?? '09:00';
            const endTime = cadenceDetails.endTime ?? '10:00';
            childMeta.startDate = `${dateStr}T${startTime}:00`;
            childMeta.endDate = `${dateStr}T${endTime}:00`;
            if (cadenceDetails.location)
                childMeta.location = cadenceDetails.location;
        }
        await writeEntity(filepath, childMeta, template.content);
        // Update entity index incrementally
        const index = getEntityIndex();
        if (index.isBuilt) {
            const tags = Array.isArray(childMeta.tags) ? childMeta.tags : [];
            await index.addOrUpdate(targetTypeConfig.name, id, childTitle, filepath, tags);
        }
        debug('spawner', `Created ${targetTypeConfig.name}: ${childTitle}`);
        created++;
    }
    return { created, skipped };
}
// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE SPAWNER (one-shot)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Spawn a fixed set of child entities from a template entity.
 * The template entity must have a field (childrenField) containing an array of ChildSpec.
 * Idempotent: skips children whose title already exists in the target directory.
 */
export async function spawnTemplate(template, spawnerConfig, targetTypeConfig) {
    const childrenField = spawnerConfig.childrenField ?? 'children';
    const children = template.meta[childrenField];
    if (!Array.isArray(children) || children.length === 0) {
        debug('spawner', `Template "${template.meta.title}" has no children to spawn`);
        return { created: 0, skipped: 0 };
    }
    const { storage, paths } = getPlatform();
    const targetDir = await ensureEntityDir(targetTypeConfig.name);
    const existingFiles = await safeReaddir(targetDir);
    const existingTitles = new Set(await Promise.all(existingFiles.filter(f => f.endsWith('.md')).map(async (f) => {
        const raw = await storage.readFile(paths.join(targetDir, f), 'utf-8');
        return String(matter(raw).data.title ?? '').toLowerCase();
    })));
    let created = 0;
    let skipped = 0;
    for (const child of children) {
        if (!child.title)
            continue;
        if (existingTitles.has(child.title.toLowerCase())) {
            skipped++;
            continue;
        }
        const id = generateEntityId(targetTypeConfig.name);
        const filepath = paths.join(targetDir, entityFilename(child.title, id));
        const childMeta = {
            id,
            title: child.title,
            entityType: targetTypeConfig.name,
            created: new Date().toISOString(),
            tags: [...(targetTypeConfig.defaultTags ?? [])],
            ...(child.fields ?? {}),
        };
        // Apply defaults from field definitions
        for (const fieldDef of targetTypeConfig.fields) {
            if (childMeta[fieldDef.key] === undefined && fieldDef.default !== undefined) {
                childMeta[fieldDef.key] = fieldDef.default;
            }
        }
        await writeEntity(filepath, childMeta, child.body ?? '');
        const index = getEntityIndex();
        if (index.isBuilt) {
            const tags = Array.isArray(childMeta.tags) ? childMeta.tags : [];
            await index.addOrUpdate(targetTypeConfig.name, id, child.title, filepath, tags);
        }
        debug('spawner', `Spawned ${targetTypeConfig.name}: ${child.title}`);
        created++;
    }
    return { created, skipped };
}
// ─────────────────────────────────────────────────────────────────────────────
// UNIFIED ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Spawn children from a template entity.
 * Resolves the target entity type from the spawner config, then delegates to
 * the appropriate spawn mode.
 */
export async function spawn(template, spawnerConfig, opts = {}) {
    // Resolve target entity type
    const targetTypeName = spawnerConfig.targetTypeField
        ? template.meta[spawnerConfig.targetTypeField]
        : null;
    if (!targetTypeName) {
        throw new Error(`Spawner requires targetTypeField to be set on the template entity`);
    }
    const targetTypeConfig = await getEntityType(targetTypeName);
    if (!targetTypeConfig) {
        throw new Error(`Unknown target entity type: "${targetTypeName}"`);
    }
    if (spawnerConfig.mode === 'date-series') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const start = opts.startDate ?? today;
        const end = opts.endDate ?? (() => {
            const d = new Date(today);
            d.setDate(d.getDate() + 60);
            return d;
        })();
        return spawnDateSeries(template, spawnerConfig, targetTypeConfig, start, end);
    }
    if (spawnerConfig.mode === 'template') {
        return spawnTemplate(template, spawnerConfig, targetTypeConfig);
    }
    throw new Error(`Unknown spawner mode: "${spawnerConfig.mode}"`);
}
// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
async function safeReaddir(dir) {
    try {
        return await getPlatform().storage.readdir(dir);
    }
    catch {
        return [];
    }
}
