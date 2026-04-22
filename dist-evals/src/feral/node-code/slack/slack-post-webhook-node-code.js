// ─────────────────────────────────────────────────────────────────────────────
// Feral Slack — SlackPostWebhook NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { AbstractNodeCode } from '../../node-code/abstract-node-code.js';
import { NodeCodeCategory } from '../../node-code/node-code.js';
import { ResultStatus } from '../../result/result.js';
/**
 * Posts a JSON message payload from context to a Slack webhook URL.
 */
export class SlackPostWebhookNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'webhook_url', name: 'Webhook URL', description: 'Slack incoming webhook URL', type: 'string', isSecret: true },
        { key: 'message_context_path', name: 'Message Path', description: 'Context path containing the message JSON', type: 'string', isOptional: true, default: 'slack_block' },
        { key: 'response_context_path', name: 'Response Path', description: 'Context path to store the response', type: 'string', isOptional: true, default: 'slack_response' },
    ];
    constructor() {
        super('slack_post_webhook', 'Slack Post Webhook', 'Posts a message to a Slack webhook URL', NodeCodeCategory.DATA);
    }
    async process(context) {
        const webhookUrl = this.getRequiredConfigValue('webhook_url');
        const messagePath = this.getOptionalConfigValue('message_context_path', 'slack_block');
        const responsePath = this.getOptionalConfigValue('response_context_path', 'slack_response');
        if (!context.has(messagePath)) {
            return this.result(ResultStatus.ERROR, `No message found at context path "${messagePath}"`);
        }
        const message = context.get(messagePath);
        const jsonBody = typeof message === 'string' ? message : JSON.stringify(message);
        try {
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: jsonBody,
            });
            const responseBody = await response.text();
            context.set(responsePath, responseBody);
            if (response.ok) {
                return this.result(ResultStatus.OK, `Webhook POST → ${response.status}`);
            }
            return this.result(ResultStatus.ERROR, `Webhook POST failed → ${response.status}: ${responseBody.substring(0, 200)}`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.result(ResultStatus.ERROR, `Webhook POST error: ${message}`);
        }
    }
}
