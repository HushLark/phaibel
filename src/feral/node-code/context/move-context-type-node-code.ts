// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Move Context Type NodeCode
// ─────────────────────────────────────────────────────────────────────────────
//
// Reclassifies a node from one context type to another (e.g. person → family).
// This is NOT a file move: it reconciles fields against the target schema,
// recomputes relevance dimensions, relocates the file, and rewrites inbound links
// (see src/cxms/move-context-type.ts).
//
// Generic + config-driven, like set_entity_field: the LLM configures a catalog
// node (from_type, to_type, node id/title, field_map) to perform a specific move.
// Pair with `preview_move_context_type` first to learn required target fields.
//
// The node to move is resolved from: node_id (preferred) → node_title (+from_type).
// field_map is a JSON object of target field values to apply (e.g. inferred
// required fields like {"relationship":"Spouse"}); it wins over carried values.
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { findEntityByTitle, type EntityTypeName } from '../../../entities/entity.js';
import { moveContextType } from '../../../cxms/move-context-type.js';

const BLOCKED = 'blocked';

function parseFieldMap(raw: string | null): Record<string, unknown> {
    if (!raw || !raw.trim()) return {};
    try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v as Record<string, unknown> : {}; }
    catch { return {}; }
}

export class MoveContextTypeNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'from_type', name: 'From Type', description: 'The node\'s current context type (e.g. person).', type: 'string' },
        { key: 'to_type', name: 'To Type', description: 'The target context type to move the node into (e.g. family).', type: 'string' },
        { key: 'node_id', name: 'Node ID', description: 'Id of the node to move. Supports {context_key} interpolation.', type: 'string', isOptional: true },
        { key: 'node_title', name: 'Node Title', description: 'Title of the node to move (used if node_id is absent). Supports interpolation.', type: 'string', isOptional: true },
        { key: 'field_map', name: 'Field Map (JSON)', description: 'JSON object of target field values to apply, e.g. {"relationship":"Spouse"}. Wins over carried fields. Supports interpolation.', type: 'string', isOptional: true },
        { key: 'force', name: 'Force', description: 'Move even if required target fields are missing (they stay unset). "true" to enable.', type: 'string', isOptional: true },
        { key: 'context_path', name: 'Context Path', description: 'Context key to store the move result.', type: 'string', default: 'move_result', isOptional: true },
    ];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Node moved to the new context type.' },
        { status: BLOCKED, description: 'Move blocked — required target fields missing. Provide them via field_map (see preview_move_context_type) or set force.' },
        { status: ResultStatus.ERROR, description: 'Move failed (node/type not found or validation error).' },
    ];

    constructor() {
        super(
            'move_context_type',
            'Move Context Type',
            'Reclassifies a node into a different context type — reconciles fields to the target schema, recomputes relevance dimensions, moves the file, and rewrites inbound links. Use preview_move_context_type first to learn required fields.',
            NodeCodeCategory.DATA,
        );
    }

    async process(context: Context): Promise<Result> {
        const fromType = this.getRequiredConfigValue('from_type') as EntityTypeName;
        const toType = this.getRequiredConfigValue('to_type') as string;
        const contextPath = (this.getOptionalConfigValue('context_path', 'move_result') as string);
        const force = String(this.getOptionalConfigValue('force', '') ?? '').toLowerCase() === 'true';
        const fieldMap = parseFieldMap(this.interpolate((this.getOptionalConfigValue('field_map', '') as string) ?? '', context));

        // Resolve the node id: explicit node_id, else look up by title within from_type.
        let nodeId = this.interpolate((this.getOptionalConfigValue('node_id', '') as string) ?? '', context).trim();
        if (!nodeId) {
            const title = this.interpolate((this.getOptionalConfigValue('node_title', '') as string) ?? '', context).trim();
            if (!title) return this.result(ResultStatus.ERROR, 'Provide node_id or node_title to identify the node to move.');
            const found = await findEntityByTitle(fromType, title);
            if (!found) return this.result(ResultStatus.ERROR, `${fromType} "${title}" not found.`);
            nodeId = String(found.meta.id);
        }

        const res = await moveContextType(nodeId, fromType, toType, { fieldMap, force });
        context.set(contextPath, res);

        if (!res.ok) {
            const blocked = /missing required/i.test(res.message ?? '');
            context.set('error', res.message ?? 'move failed');
            return this.result(blocked ? BLOCKED : ResultStatus.ERROR, res.message ?? 'Move failed.');
        }

        const notes = [
            `moved ${fromType}:${nodeId} → ${toType}`,
            res.inboundRewritten ? `${res.inboundRewritten} inbound link(s) re-pointed` : '',
            res.droppedFields.length ? `dropped fields: ${res.droppedFields.join(', ')}` : '',
            res.relevanceWarnings.length ? `relevance note: ${res.relevanceWarnings.join('; ')}` : '',
        ].filter(Boolean);
        return this.result(ResultStatus.OK, notes.join(' · '));
    }
}
