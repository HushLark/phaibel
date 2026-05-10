// ─────────────────────────────────────────────────────────────────────────────
// TOKEN RESOLVER
// Replaces {{local_time:ISO}}, {{local_date:ISO}}, {{local_datetime:ISO}}
// tokens in LLM output with human-readable local-timezone strings.
// Tokens are resolved deterministically — the LLM never needs to do timezone math.
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN_RE = /\{\{(local_time|local_date|local_datetime):([^}]+)\}\}/g;

function pad(n: number): string {
    return String(n).padStart(2, '0');
}

function formatLocalTime(d: Date): string {
    const h = d.getHours();
    const min = pad(d.getMinutes());
    const ampm = h < 12 ? 'AM' : 'PM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${min} ${ampm}`;
}

function formatLocalDate(d: Date): string {
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatLocalDatetime(d: Date): string {
    return `${formatLocalDate(d)} at ${formatLocalTime(d)}`;
}

/**
 * Replace all date/time tokens in text with local-timezone strings.
 * Unknown or unparseable tokens are left as-is.
 */
export function resolveTokens(text: string): string {
    return text.replace(TOKEN_RE, (_match, type: string, isoArg: string) => {
        const d = new Date(isoArg.trim());
        if (isNaN(d.getTime())) return _match; // leave malformed tokens intact

        switch (type) {
            case 'local_time':     return formatLocalTime(d);
            case 'local_date':     return formatLocalDate(d);
            case 'local_datetime': return formatLocalDatetime(d);
            default:               return _match;
        }
    });
}

/**
 * Instruction block to include in LLM prompts so the model knows to use tokens.
 */
export const TOKEN_INSTRUCTIONS = `DATETIME TOKENS: When displaying event times or dates from data, use these tokens instead of raw ISO strings — a deterministic function will replace them with the user's local time:
- {{local_time:ISO}} → e.g. "9:30 AM"
- {{local_date:ISO}} → e.g. "May 7, 2026"
- {{local_datetime:ISO}} → e.g. "May 7, 2026 at 9:30 AM"
Example: "Your standup is at {{local_time:2026-05-07T15:30:00Z}}" → "Your standup is at 9:30 AM"`;
