// ─────────────────────────────────────────────────────────────────────────────
// JSON Parser — shared LLM JSON parsing utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strip markdown fences, fix common LLM JSON mistakes, and trim whitespace.
 */
export function cleanJson(raw: string): string {
    let s = raw.trim();
    // Remove ```json ... ``` or ``` ... ```
    s = s.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    // Fix trailing commas before } or ] (very common LLM error)
    s = s.replace(/,\s*([\}\]])/g, '$1');
    // Fix missing closing quotes: "key": "value\n  →  "key": "value"\n
    s = s.replace(/":\s*"([^"]*?)(\n)/g, '": "$1"$2');
    return s.trim();
}

/**
 * Try multiple strategies to extract a JSON object from an LLM response.
 * Returns parsed object or throws.
 */
export function parseJsonResponse(raw: string): Record<string, unknown> {
    // Strategy 1: clean and parse directly
    const cleaned = cleanJson(raw);
    try {
        return JSON.parse(cleaned);
    } catch {
        // continue to fallback strategies
    }

    // Strategy 2: extract the outermost { ... } block (handles preamble/postamble text)
    const firstBrace = cleaned.indexOf('{');
    if (firstBrace >= 0) {
        let depth = 0;
        let inString = false;
        let escape = false;
        for (let i = firstBrace; i < cleaned.length; i++) {
            const ch = cleaned[i];
            if (escape) { escape = false; continue; }
            if (ch === '\\' && inString) { escape = true; continue; }
            if (ch === '"') { inString = !inString; continue; }
            if (inString) continue;
            if (ch === '{') depth++;
            if (ch === '}') {
                depth--;
                if (depth === 0) {
                    try {
                        return JSON.parse(cleaned.slice(firstBrace, i + 1));
                    } catch {
                        break;
                    }
                }
            }
        }
    }

    // Strategy 3: try to fix truncated JSON by closing open braces/brackets
    if (firstBrace >= 0) {
        try {
            let fixed = cleaned.slice(firstBrace);

            // Track state to find where truncation happened
            let inStr = false, esc = false;
            const stack: string[] = []; // tracks { and [
            let lastValidPos = 0;

            for (let i = 0; i < fixed.length; i++) {
                const ch = fixed[i];
                if (esc) { esc = false; continue; }
                if (ch === '\\' && inStr) { esc = true; continue; }
                if (ch === '"') { inStr = !inStr; continue; }
                if (inStr) continue;
                if (ch === '{') { stack.push('}'); lastValidPos = i; }
                else if (ch === '[') { stack.push(']'); lastValidPos = i; }
                else if (ch === '}' || ch === ']') { stack.pop(); lastValidPos = i; }
                else if (ch === ',' || ch === ':') { lastValidPos = i; }
            }

            // If we ended inside a string, close it and trim back
            if (inStr) {
                // Find the last opening quote and truncate the partial string value
                const lastQuote = fixed.lastIndexOf('"');
                if (lastQuote > 0) {
                    fixed = fixed.slice(0, lastQuote) + '"';
                }
            }

            // Remove trailing partial entries (after last comma or colon)
            fixed = fixed.replace(/,\s*"[^"]*"?\s*:?\s*("(?:[^"\\]|\\.)*"?)?[^}\]]*$/, '');
            fixed = fixed.replace(/,\s*$/, '');
            // Remove trailing colon with no value
            fixed = fixed.replace(/:\s*$/, ': null');

            // Close remaining open brackets and braces
            // Re-count after fixups
            let braces = 0, brackets = 0;
            inStr = false; esc = false;
            for (const ch of fixed) {
                if (esc) { esc = false; continue; }
                if (ch === '\\' && inStr) { esc = true; continue; }
                if (ch === '"') { inStr = !inStr; continue; }
                if (inStr) continue;
                if (ch === '{') braces++;
                if (ch === '}') braces--;
                if (ch === '[') brackets++;
                if (ch === ']') brackets--;
            }
            // If still inside a string after fixups, close it
            if (inStr) fixed += '"';
            for (let i = 0; i < brackets; i++) fixed += ']';
            for (let i = 0; i < braces; i++) fixed += '}';

            return JSON.parse(fixed);
        } catch {
            // give up
        }
    }

    throw new Error(`Invalid JSON: ${cleaned.slice(0, 200)}…`);
}

/**
 * Extract the "response" field value from a synthesis JSON response even when
 * the JSON is malformed (e.g. the LLM left unescaped double-quotes inside the
 * string value).  Finds the region between `"response": "` and the last `"`
 * that sits before `"assumed_nodes"`, then
 * unescapes standard JSON escape sequences.
 *
 * Returns null if the field cannot be located.
 */
export function extractResponseField(raw: string): string | null {
    const keyIdx = raw.indexOf('"response"');
    if (keyIdx < 0) return null;
    const colonIdx = raw.indexOf(':', keyIdx);
    if (colonIdx < 0) return null;
    const openQuote = raw.indexOf('"', colonIdx + 1);
    if (openQuote < 0) return null;

    // Anchor on the next top-level key so we know where the value must end.
    const anchors = ['"assumed_nodes"'];
    let endBoundary = Infinity;
    for (const a of anchors) {
        const idx = raw.indexOf(a, openQuote + 1);
        if (idx > 0 && idx < endBoundary) endBoundary = idx;
    }
    if (!isFinite(endBoundary)) return null;

    // The closing quote of the value is the last `"` before the next key.
    const region = raw.slice(openQuote + 1, endBoundary);
    const closeQuote = region.lastIndexOf('"');
    if (closeQuote < 0) return null;

    const rawValue = region.slice(0, closeQuote);

    // Unescape standard JSON escape sequences.
    return rawValue
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\r/g, '\r')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
}
