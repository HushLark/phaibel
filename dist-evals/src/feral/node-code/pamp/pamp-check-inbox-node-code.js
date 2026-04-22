// ─────────────────────────────────────────────────────────────────────────────
// Feral PAMP — Check Inbox NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { PampClient } from '../../../pamp/client.js';
import { requireIdentity } from '../../../pamp/storage.js';
export class PampCheckInboxNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'result_context_path', name: 'Result Path', description: 'Context key to store the message headers array.', type: 'string', default: 'pamp_messages' },
        { key: 'unread_only', name: 'Unread Only', description: 'Only fetch unread messages.', type: 'boolean', default: true, isOptional: true },
    ];
    static resultDescriptions = [
        { status: ResultStatus.OK, description: 'Inbox checked successfully.' },
        { status: ResultStatus.ERROR, description: 'Failed to check inbox.' },
    ];
    constructor() {
        super('pamp_check_inbox', 'PAMP Check Inbox', 'Fetch message headers from the PAMP inbox.', NodeCodeCategory.DATA);
    }
    async process(context) {
        const resultPath = this.getOptionalConfigValue('result_context_path', 'pamp_messages');
        const unreadOnly = this.getOptionalConfigValue('unread_only', true);
        try {
            const identity = await requireIdentity();
            const client = new PampClient(identity);
            const headers = await client.listMessages({ unread: unreadOnly });
            context.set(resultPath, headers);
            return this.result(ResultStatus.OK, `Fetched ${headers.length} message(s).`);
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return this.result(ResultStatus.ERROR, `PAMP inbox check failed: ${msg}`);
        }
    }
}
