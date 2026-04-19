// ─────────────────────────────────────────────────────────────────────────────
// ENTITY SUMMARY GENERATOR
// Generates a one-sentence LLM summary for an entity, persisted in frontmatter.
// ─────────────────────────────────────────────────────────────────────────────

import { getModelForCapability } from '../llm/router.js';
import { debug } from '../utils/debug.js';

/**
 * Generate a short summary (max 150 chars) for an entity using the 'summarize' LLM capability.
 * Falls back to the first 150 chars of body content on failure.
 */
export async function generateEntitySummary(
    entityType: string,
    title: string,
    content: string,
    meta: Record<string, unknown>,
): Promise<string> {
    try {
        const llm = await getModelForCapability('summarize');

        const metaSnippet = Object.entries(meta)
            .filter(([k]) => !['id', '_filepath', 'created', 'updated', 'summary'].includes(k))
            .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
            .join('\n');

        const prompt = `Summarize this ${entityType} in one sentence (max 150 chars). Return ONLY the summary, no quotes or prefix.

Title: ${title}
${metaSnippet ? `Metadata:\n${metaSnippet}\n` : ''}${content ? `Content:\n${content.slice(0, 500)}` : ''}`;

        const summary = await llm.chat(
            [{ role: 'user', content: prompt }],
            { maxTokens: 100, temperature: 0.3 },
        );

        const trimmed = summary.trim().slice(0, 150);
        return trimmed || fallback(content);
    } catch (err) {
        debug('summary', `LLM summary failed, using fallback: ${err}`);
        return fallback(content);
    }
}

function fallback(content: string): string {
    if (!content) return '';
    return content.replace(/\s+/g, ' ').trim().slice(0, 150);
}
