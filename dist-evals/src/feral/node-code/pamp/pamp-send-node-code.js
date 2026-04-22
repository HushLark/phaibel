// ─────────────────────────────────────────────────────────────────────────────
// Feral PAMP — Send Message NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { PampClient } from '../../../pamp/client.js';
import { requireIdentity } from '../../../pamp/storage.js';
export class PampSendNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'to_address', name: 'To Address', description: 'PAMP address to send to. Supports {context_key} interpolation.', type: 'string' },
        { key: 'body_context_path', name: 'Body Context Path', description: 'Context key containing the message body.', type: 'string' },
        { key: 'content_type', name: 'Content Type', description: 'Message content type.', type: 'string', default: 'text/plain', isOptional: true },
        { key: 'reply_to', name: 'Reply To', description: 'Message ID to reply to (threading).', type: 'string', isOptional: true },
        { key: 'result_context_path', name: 'Result Path', description: 'Context key to store the sent message ID.', type: 'string', default: 'pamp_sent_id' },
    ];
    static resultDescriptions = [
        { status: ResultStatus.OK, description: 'Message sent successfully.' },
        { status: ResultStatus.ERROR, description: 'Failed to send message.' },
    ];
    constructor() {
        super('pamp_send', 'PAMP Send Message', 'Send an encrypted PAMP message to another mailbox.', NodeCodeCategory.DATA);
    }
    async process(context) {
        const toTemplate = this.getRequiredConfigValue('to_address');
        const bodyPath = this.getRequiredConfigValue('body_context_path');
        const contentType = this.getOptionalConfigValue('content_type', 'text/plain');
        const replyTo = this.getOptionalConfigValue('reply_to');
        const resultPath = this.getOptionalConfigValue('result_context_path', 'pamp_sent_id');
        const toAddress = toTemplate.replace(/\{(\w+)\}/g, (_, key) => String(context.get(key) ?? ''));
        const body = String(context.get(bodyPath) ?? '');
        if (!body) {
            return this.result(ResultStatus.ERROR, `No body found at context key "${bodyPath}".`);
        }
        try {
            const identity = await requireIdentity();
            const client = new PampClient(identity);
            const message = await client.sendMessage(toAddress, body, contentType, replyTo ?? undefined);
            context.set(resultPath, message.header.message_id);
            return this.result(ResultStatus.OK, `Sent message ${message.header.message_id} to ${toAddress}.`);
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return this.result(ResultStatus.ERROR, `PAMP send failed: ${msg}`);
        }
    }
}
