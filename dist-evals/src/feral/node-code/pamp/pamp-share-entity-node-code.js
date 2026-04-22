// ─────────────────────────────────────────────────────────────────────────────
// Feral PAMP — Share Entity NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { PampClient } from '../../../pamp/client.js';
import { requireIdentity } from '../../../pamp/storage.js';
export class PampShareEntityNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'to_address', name: 'To Address', description: 'PAMP address to send to. Supports {context_key} interpolation.', type: 'string' },
        { key: 'entity_context_path', name: 'Entity Path', description: 'Context key containing the entity object to share.', type: 'string' },
        { key: 'result_context_path', name: 'Result Path', description: 'Context key to store the sent message ID.', type: 'string', default: 'pamp_shared_id' },
    ];
    static resultDescriptions = [
        { status: ResultStatus.OK, description: 'Entity shared successfully.' },
        { status: ResultStatus.ERROR, description: 'Failed to share entity.' },
    ];
    constructor() {
        super('pamp_share_entity', 'PAMP Share Entity', 'Share a vault entity with another agent via PAMP.', NodeCodeCategory.DATA);
    }
    async process(context) {
        const toTemplate = this.getRequiredConfigValue('to_address');
        const entityPath = this.getRequiredConfigValue('entity_context_path');
        const resultPath = this.getOptionalConfigValue('result_context_path', 'pamp_shared_id');
        const toAddress = toTemplate.replace(/\{(\w+)\}/g, (_, key) => String(context.get(key) ?? ''));
        const entity = context.get(entityPath);
        if (!entity) {
            return this.result(ResultStatus.ERROR, `No entity found at context key "${entityPath}".`);
        }
        const body = typeof entity === 'string' ? entity : JSON.stringify(entity);
        try {
            const identity = await requireIdentity();
            const client = new PampClient(identity);
            const message = await client.sendMessage(toAddress, body, 'application/json');
            context.set(resultPath, message.header.message_id);
            return this.result(ResultStatus.OK, `Shared entity to ${toAddress} as ${message.header.message_id}.`);
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return this.result(ResultStatus.ERROR, `PAMP share failed: ${msg}`);
        }
    }
}
