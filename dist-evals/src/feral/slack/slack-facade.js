// ─────────────────────────────────────────────────────────────────────────────
// Feral Slack — Facade (Webhook API)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * High-level API for sending messages to Slack via webhooks.
 */
export class SlackFacade {
    webhookUrl;
    constructor(webhookUrl) {
        this.webhookUrl = webhookUrl;
    }
    /**
     * Serialize and send a Message object to the Slack webhook.
     */
    async sendMessage(message) {
        const json = JSON.stringify(message.toJSON());
        return this.send(json);
    }
    /**
     * Send a raw JSON string to the Slack webhook.
     */
    async send(jsonBody) {
        const response = await fetch(this.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: jsonBody,
        });
        if (!response.ok) {
            const body = await response.text();
            throw new NetworkCallError(`Slack webhook POST failed: ${response.status} ${response.statusText} — ${body}`);
        }
        return response.text();
    }
}
export class NetworkCallError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NetworkCallError';
    }
}
