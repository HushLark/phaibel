// ─────────────────────────────────────────────────────────────────────────────
// Feral PAMP — Await Reply NodeCode
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { PampClient } from '../../../pamp/client.js';
import { requireIdentity } from '../../../pamp/storage.js';
import type { PampEnvelopeHeader } from '../../../pamp/types.js';

export class PampAwaitReplyNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'message_id', name: 'Message ID', description: 'The message ID to await a reply for. Supports {context_key} interpolation.', type: 'string' },
        { key: 'timeout_seconds', name: 'Timeout', description: 'Max seconds to wait for a reply.', type: 'int', default: 60, isOptional: true },
        { key: 'poll_interval_seconds', name: 'Poll Interval', description: 'Seconds between inbox polls.', type: 'int', default: 5, isOptional: true },
        { key: 'result_context_path', name: 'Result Path', description: 'Context key to store the reply message header.', type: 'string', default: 'pamp_reply' },
    ];

    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Reply received within timeout.' },
        { status: ResultStatus.ERROR, description: 'Timed out or failed waiting for reply.' },
    ];

    constructor() {
        super('pamp_await_reply', 'PAMP Await Reply', 'Poll the inbox for a reply to a specific message.', NodeCodeCategory.DATA);
    }

    async process(context: Context): Promise<Result> {
        const msgIdTemplate = this.getRequiredConfigValue('message_id') as string;
        const timeout = this.getOptionalConfigValue('timeout_seconds', 60) as number;
        const pollInterval = this.getOptionalConfigValue('poll_interval_seconds', 5) as number;
        const resultPath = this.getOptionalConfigValue('result_context_path', 'pamp_reply') as string;

        const messageId = msgIdTemplate.replace(/\{(\w+)\}/g, (_, key: string) => String(context.get(key) ?? ''));

        try {
            const identity = await requireIdentity();
            const client = new PampClient(identity);

            const deadline = Date.now() + timeout * 1000;

            while (Date.now() < deadline) {
                const headers = await client.listMessages({ unread: true });
                const reply = headers.find((h: PampEnvelopeHeader) =>
                    h.chain && h.chain.includes(messageId),
                );

                if (reply) {
                    context.set(resultPath, reply);
                    return this.result(ResultStatus.OK, `Reply received: ${reply.message_id}`);
                }

                // Wait before polling again
                await new Promise(resolve => setTimeout(resolve, pollInterval * 1000));
            }

            return this.result(ResultStatus.ERROR, `Timed out after ${timeout}s waiting for reply to ${messageId}.`);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return this.result(ResultStatus.ERROR, `PAMP await reply failed: ${msg}`);
        }
    }
}
