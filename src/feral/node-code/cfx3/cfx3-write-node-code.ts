// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — CF/x3 Write NodeCode: CRUD a context node/type on a CF/x3 source.
// Pure context federation — no domain tool calls (those go via MCP).
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { writeToSourceById } from '../../../cfx3/service.js';
import type { Cfx3WriteOp, Cfx3WriteRequest } from '../../../cfx3/protocol.js';

export class Cfx3WriteNodeCode extends AbstractNodeCode {
    readonly allowExtraConfig = true;

    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'source_id', name: 'Source ID', description: 'The CF/x3 source to write to.', type: 'string' },
        { key: 'op', name: 'Operation', description: 'node.create | node.update | node.delete | type.create | type.update | type.delete.', type: 'string', default: 'node.create' },
        { key: 'input_context_path', name: 'Input Path', description: 'Context key holding the write payload ({ node } / { type } / { uid }).', type: 'string', default: 'cfx3_write' },
        { key: 'result_context_path', name: 'Result Path', description: 'Context key to store the write result.', type: 'string', default: 'cfx3_write_result' },
    ];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Context write succeeded.' },
        { status: ResultStatus.ERROR, description: 'Context write failed or was rejected.' },
    ];

    constructor() {
        super('cfx3_write', 'CF/x3 Write', 'Create/update/delete a context node or type on a CF/x3 source.', NodeCodeCategory.DATA);
    }

    async process(context: Context): Promise<Result> {
        const sourceId = this.getRequiredConfigValue('source_id') as string;
        const op = this.getRequiredConfigValue('op', 'node.create') as Cfx3WriteOp;
        const inputPath = this.getRequiredConfigValue('input_context_path', 'cfx3_write') as string;
        const resultPath = this.getRequiredConfigValue('result_context_path', 'cfx3_write_result') as string;

        const input = (context.has(inputPath) && typeof context.get(inputPath) === 'object'
            ? context.get(inputPath) : {}) as Record<string, unknown>;
        const req: Cfx3WriteRequest = { op, ...input };

        try {
            const res = await writeToSourceById(sourceId, req);
            context.set(resultPath, res);
            return res.ok
                ? this.result(ResultStatus.OK, `CF/x3 ${sourceId} ${op} ok${res.uid ? ` (${res.uid})` : ''}.`)
                : this.result(ResultStatus.ERROR, `CF/x3 ${sourceId} ${op}: ${res.message ?? 'rejected'}`);
        } catch (err) {
            return this.result(ResultStatus.ERROR, `CF/x3 write failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
