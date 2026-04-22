// ─────────────────────────────────────────────────────────────────────────────
// Feral Slack — Markdown Formatter
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Escapes and formats text for Slack's mrkdwn syntax.
 */
export class SlackMarkdownFormatter {
    /**
     * Escape special characters for Slack mrkdwn.
     */
    static format(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
    /**
     * Wrap text in bold (*...*) with escaping.
     */
    static bold(text) {
        return `*${SlackMarkdownFormatter.format(text)}*`;
    }
    /**
     * Wrap text in underline (_..._) with escaping.
     */
    static underline(text) {
        return `_${SlackMarkdownFormatter.format(text)}_`;
    }
    /**
     * Wrap text in strikethrough (~...~) with escaping.
     */
    static strike(text) {
        return `~${SlackMarkdownFormatter.format(text)}~`;
    }
}
