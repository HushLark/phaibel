// ─────────────────────────────────────────────────────────────────────────────
// PROGRESSIVE INTERVIEW
// Scans recently modified entities for completeness gaps, surfaces questions
// to the user, and writes answers back to the vault.
// ─────────────────────────────────────────────────────────────────────────────

import { getEntityIndex } from '../entities/entity-index.js';
import { loadEntityTypes } from '../entities/entity-type-config.js';
import { parseEntity, writeEntity } from '../entities/entity.js';
import { getPlatform } from '../platform/index.js';
import type { IndexNode } from '../entities/entity-index.js';
import type { EntityTypeConfig, FieldDef } from '../entities/entity-type-config.js';

// Fields that are always present or managed by the system — never ask about them.
const SKIP_FIELDS = new Set([
    'id', 'created', 'updated', 'entityType', 'contextType',
    'sourceId', 'isMe', 'name', 'title', 'description', 'summary',
]);

export interface CompletenessGap {
    field: FieldDef;
    question: string;
    options?: string[];
    priority: number; // 3=required, 2=reference, 1=optional
}

export interface InterviewCandidate {
    entityKey: string;   // e.g. "person:sarah-chen"
    entityName: string;
    entityType: string;
    gaps: CompletenessGap[];
}

// ─────────────────────────────────────────────────────────────────────────────
// GAP DETECTION
// ─────────────────────────────────────────────────────────────────────────────

function buildQuestion(entityName: string, field: FieldDef): string {
    const label = field.label ?? field.key;
    if (field.type === 'reference') {
        return `What ${label} is ${entityName} associated with?`;
    }
    return `What is ${entityName}'s ${label}?`;
}

export function checkEntityCompleteness(
    entity: IndexNode,
    typeConfig: EntityTypeConfig,
): CompletenessGap[] {
    const gaps: CompletenessGap[] = [];

    for (const field of typeConfig.fields) {
        if (SKIP_FIELDS.has(field.key)) continue;

        const value = entity.meta[field.key];
        const isEmpty =
            value === undefined ||
            value === null ||
            value === '' ||
            (Array.isArray(value) && value.length === 0);

        if (!isEmpty) continue;

        const priority = field.required ? 3 : field.type === 'reference' ? 2 : 1;

        gaps.push({
            field,
            question: buildQuestion(entity.title, field),
            options: field.values,
            priority,
        });
    }

    return gaps.sort((a, b) => b.priority - a.priority);
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION SCAN
// ─────────────────────────────────────────────────────────────────────────────

export async function scanForIncompleteEntities(
    sinceHoursAgo = 168,
): Promise<InterviewCandidate[]> {
    const index = getEntityIndex();
    if (!index.isBuilt) return [];

    const types = await loadEntityTypes();
    const typeMap = new Map<string, EntityTypeConfig>(types.map(t => [t.name, t]));

    const cutoff = Date.now() - sinceHoursAgo * 3_600_000;
    const candidates: InterviewCandidate[] = [];

    for (const node of index.getNodes()) {
        const typeConfig = typeMap.get(node.type);
        if (!typeConfig || typeConfig.fields.length === 0) continue;

        // Skip externally-synced nodes — user can't own their missing fields
        if (typeof node.meta.sourceId === 'string' && node.meta.sourceId.length > 0) continue;

        // Filter to recently modified entities
        const updated = node.meta.updated as string | undefined;
        if (updated) {
            const updatedMs = new Date(updated).getTime();
            if (isNaN(updatedMs) || updatedMs < cutoff) continue;
        } else {
            // No updated timestamp — skip
            continue;
        }

        const gaps = checkEntityCompleteness(node, typeConfig);
        if (gaps.length === 0) continue;

        const entityKey = `${node.type}:${node.id}`;
        candidates.push({ entityKey, entityName: node.title, entityType: node.type, gaps });
    }

    // Sort by highest-priority gap descending, cap at 10 before caller shuffles
    candidates.sort((a, b) => (b.gaps[0]?.priority ?? 0) - (a.gaps[0]?.priority ?? 0));
    return candidates.slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// ANSWER APPLICATION
// ─────────────────────────────────────────────────────────────────────────────

export async function applyProgressiveAnswers(
    entityKey: string,
    answers: Record<string, string>,
): Promise<void> {
    if (Object.keys(answers).length === 0) return;

    const index = getEntityIndex();
    const node = index.getNode(entityKey);
    if (!node?.filepath) return;

    const { storage } = getPlatform();
    const rawContent = await storage.readFile(node.filepath, 'utf-8');
    const { meta, content } = parseEntity(node.filepath, rawContent);

    for (const [key, value] of Object.entries(answers)) {
        if (value && value !== '__cancel__') {
            meta[key] = value;
        }
    }

    await writeEntity(node.filepath, meta, content);

    // Refresh the node in the index (addOrUpdate re-reads the file)
    const colonIdx = entityKey.indexOf(':');
    const type = entityKey.slice(0, colonIdx);
    const id = entityKey.slice(colonIdx + 1);
    await index.addOrUpdate(type, id, node.name, node.filepath, node.description);
}
