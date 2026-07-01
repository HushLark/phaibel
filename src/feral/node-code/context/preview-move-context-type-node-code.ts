// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Preview Move Context Type NodeCode
// ─────────────────────────────────────────────────────────────────────────────
//
// Read-only companion to move_context_type. Reports the reclassification plan:
// which fields carry over, which the target requires but the source lacks (so the
// caller can INFER + CONFIRM values), which fields would be dropped, how many
// inbound links would be re-pointed, and which relevance layers would go inactive.
// No writes — use this before move_context_type.
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { findEntityByTitle, type EntityTypeName } from '../../../entities/entity.js';
import { previewMoveContextType } from '../../../cxms/move-context-type.js';

function parseFieldMap(raw: string | null): Record<string, unknown> {
    if (!raw || !raw.trim()) return {};
    try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v as Record<string, unknown> : {}; }
    catch { return {}; }
}

export class PreviewMoveContextTypeNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'from_type', name: 'From Type', description: 'The node\'s current context type (e.g. person).', type: 'string' },
        { key: 'to_type', name: 'To Type', description: 'The target context type (e.g. family).', type: 'string' },
        { key: 'node_id', name: 'Node ID', description: 'Id of the node. Supports {context_key} interpolation.', type: 'string', isOptional: true },
        { key: 'node_title', name: 'Node Title', description: 'Title of the node (used if node_id is absent). Supports interpolation.', type: 'string', isOptional: true },
        { key: 'field_map', name: 'Field Map (JSON)', description: 'Optional JSON of proposed target field values to test against the plan.', type: 'string', isOptional: true },
        { key: 'context_path', name: 'Context Path', description: 'Context key to store the preview.', type: 'string', default: 'move_preview', isOptional: true },
    ];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Preview computed and stored.' },
        { status: ResultStatus.ERROR, description: 'Preview failed (node/type not found).' },
    ];

    constructor() {
        super(
            'preview_move_context_type',
            'Preview Move Context Type',
            'Read-only: reports the plan for moving a node to another context type — carried/dropped fields, required fields to fill, inbound links, and relevance-layer impact. Use before move_context_type.',
            NodeCodeCategory.DATA,
        );
    }

    async process(context: Context): Promise<Result> {
        const fromType = this.getRequiredConfigValue('from_type') as EntityTypeName;
        const toType = this.getRequiredConfigValue('to_type') as string;
        const contextPath = (this.getOptionalConfigValue('context_path', 'move_preview') as string);
        const fieldMap = parseFieldMap(this.interpolate((this.getOptionalConfigValue('field_map', '') as string) ?? '', context));

        let nodeId = this.interpolate((this.getOptionalConfigValue('node_id', '') as string) ?? '', context).trim();
        if (!nodeId) {
            const title = this.interpolate((this.getOptionalConfigValue('node_title', '') as string) ?? '', context).trim();
            if (!title) return this.result(ResultStatus.ERROR, 'Provide node_id or node_title to identify the node.');
            const found = await findEntityByTitle(fromType, title);
            if (!found) return this.result(ResultStatus.ERROR, `${fromType} "${title}" not found.`);
            nodeId = String(found.meta.id);
        }

        try {
            const preview = await previewMoveContextType(nodeId, fromType, toType, fieldMap);
            context.set(contextPath, preview);
            const req = preview.fields.missingRequired.map(m => m.key).join(', ');
            return this.result(ResultStatus.OK,
                `Preview: ${preview.ready ? 'ready' : 'needs fields: ' + req}. `
                + `${preview.fields.dropped.length} dropped, ${preview.inboundLinks} inbound link(s)`
                + (preview.relevanceWarnings.length ? `, ${preview.relevanceWarnings.length} relevance warning(s)` : ''));
        } catch (e) {
            context.set('error', e instanceof Error ? e.message : String(e));
            return this.result(ResultStatus.ERROR, e instanceof Error ? e.message : String(e));
        }
    }
}
