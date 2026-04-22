// ─────────────────────────────────────────────────────────────────────────────
// Scope Classifier — Heuristic scope selection for context tree
//
// Determines which parts of the context tree to materialize based on the
// user's input. Fast (sub-millisecond), no LLM call.
// ─────────────────────────────────────────────────────────────────────────────
// Keywords that suggest the user wants to see all items
const FULL_KEYWORDS = /\b(all|every|reflect|review|list|summarize|summary|overview|report|show me|audit|analyze|breakdown|digest)\b/i;
// Keywords that suggest cross-type relationships
const CROSS_KEYWORDS = /\b(relat|connect|across|between|link|depend|impact|affect|overlap)\b/i;
/**
 * Classify the appropriate context scope for a user's input.
 * Rules are ordered by specificity — first match wins.
 */
export function classifyScope(userInput, entityTypes, _stats) {
    const input = userInput.toLowerCase();
    // 1. Detect which entity types are mentioned
    const mentionedTypes = [];
    for (const et of entityTypes) {
        if (input.includes(et.name) || input.includes(et.plural)) {
            mentionedTypes.push(et.name);
        }
    }
    // 2. Cross-type keywords with multiple types mentioned
    if (CROSS_KEYWORDS.test(input) && mentionedTypes.length >= 2) {
        return { type: 'cross', branches: mentionedTypes };
    }
    // 3. Cross-type keywords without specific types → all branches
    if (CROSS_KEYWORDS.test(input) && mentionedTypes.length === 0) {
        return { type: 'cross', branches: entityTypes.map(t => t.name) };
    }
    // 4. Full keywords + type mentioned → branch-full for that type
    if (FULL_KEYWORDS.test(input) && mentionedTypes.length > 0) {
        return { type: 'branch-full', branches: mentionedTypes };
    }
    // 5. Type mentioned but no full/cross keywords → branch with summaries
    if (mentionedTypes.length > 0) {
        return { type: 'branch', branches: mentionedTypes };
    }
    // 6. Default — trunk only (lightweight for general chat)
    return { type: 'trunk' };
}
