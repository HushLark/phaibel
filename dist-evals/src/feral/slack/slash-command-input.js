// ─────────────────────────────────────────────────────────────────────────────
// Feral Slack — Slash Command Input DTO
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Strongly-typed DTO wrapping parsed Slack slash command POST data.
 */
export class SlashCommandInput {
    token;
    command;
    text;
    responseUrl;
    triggerId;
    userId;
    userName;
    teamId;
    enterpriseId;
    channelId;
    apiAppId;
    constructor(data) {
        this.token = data.token ?? '';
        this.command = data.command ?? '';
        this.text = data.text ?? '';
        this.responseUrl = data.response_url ?? '';
        this.triggerId = data.trigger_id ?? '';
        this.userId = data.user_id ?? '';
        this.userName = data.user_name ?? '';
        this.teamId = data.team_id ?? '';
        this.enterpriseId = data.enterprise_id ?? '';
        this.channelId = data.channel_id ?? '';
        this.apiAppId = data.api_app_id ?? '';
    }
}
/**
 * Parse a URL-encoded POST body into key-value pairs.
 * Equivalent to PHP's parse_str().
 */
export function parseUrlEncodedBody(body) {
    const params = new URLSearchParams(body);
    const result = {};
    for (const [key, value] of params.entries()) {
        result[key] = value;
    }
    return result;
}
