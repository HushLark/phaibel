// ─────────────────────────────────────────────────────────────────────────────
// PROGRESSIVE DISCLOSURE
// ─────────────────────────────────────────────────────────────────────────────
// Two-tier context retrieval:
//   Tier 1 — NodeSummary: keyword search → frontmatter only (id, name,
//             entityType, description, tags, created, updated). Cheap.
//   Tier 2 — NodeDetail: fetch by ID → full node (summary fields + domain
//             fields + user-written body). On-demand.
//
// The ProgressiveDisclosure phase runs before Step 1 of the chat pipeline.
// The LLM receives up to MAX_SUMMARIES summaries, requests details on the
// nodes it needs (up to MAX_ITERATIONS rounds), then returns a context
// snapshot used for Step 1/2.
// ─────────────────────────────────────────────────────────────────────────────
import { getPlatform } from '../platform/index.js';
import { getEntityIndex } from '../entities/entity-index.js';
import { parseEntity, CORE_FRONTMATTER_KEYS } from '../entities/entity.js';
import { loadEntityTypes } from '../entities/entity-type-config.js';
import { getVaultRoot } from '../state/manager.js';
import { debug } from '../utils/debug.js';
const MAX_SUMMARIES = 30;
const MAX_ITERATIONS = 3;
// ─────────────────────────────────────────────────────────────────────────────
// SEARCH — returns NodeSummary[]
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Keyword search across all entity types, returning NodeSummary (frontmatter only).
 * Uses the in-memory index when built; falls back to a lightweight filesystem scan.
 */
export async function searchSummaries(query, options) {
    const limit = options?.limit ?? MAX_SUMMARIES;
    const index = getEntityIndex();
    if (index.isBuilt) {
        const results = options?.types?.length
            ? options.types.flatMap(t => index.search(query, t))
                .sort((a, b) => b.score - a.score)
            : index.search(query);
        return results.slice(0, limit).map(({ node }) => ({
            id: node.id,
            name: node.name,
            entityType: node.type,
            description: node.description || undefined,
            tags: node.tags,
            created: node.meta.created || '',
            updated: node.meta.updated || undefined,
        }));
    }
    // Fallback: scan files directly
    const { storage, paths } = getPlatform();
    const vaultRoot = await getVaultRoot();
    const entityTypes = await loadEntityTypes();
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const summaries = [];
    for (const typeConfig of entityTypes) {
        if (options?.types?.length && !options.types.includes(typeConfig.name))
            continue;
        const dir = paths.join(vaultRoot, typeConfig.directory);
        try {
            const files = await storage.readdir(dir);
            for (const file of files) {
                if (!file.endsWith('.md') || file.startsWith('.'))
                    continue;
                const filepath = paths.join(dir, file);
                const raw = await storage.readFile(filepath, 'utf-8');
                const { meta } = parseEntity(filepath, raw);
                const name = meta.name || meta.title || '';
                const desc = meta.description || '';
                const tags = Array.isArray(meta.tags) ? meta.tags : [];
                const haystack = `${name} ${desc} ${tags.join(' ')}`.toLowerCase();
                if (tokens.every(t => haystack.includes(t))) {
                    summaries.push({
                        id: meta.id,
                        name,
                        entityType: typeConfig.name,
                        description: desc || undefined,
                        tags,
                        created: meta.created || '',
                        updated: meta.updated || undefined,
                    });
                    if (summaries.length >= limit)
                        return summaries;
                }
            }
        }
        catch { /* directory may not exist */ }
    }
    return summaries;
}
// ─────────────────────────────────────────────────────────────────────────────
// DETAIL FETCH — returns NodeDetail[]
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Fetch full NodeDetail for a list of entity IDs.
 * Reads files from disk; uses the index for fast filepath lookup.
 */
export async function getNodeDetails(ids) {
    const index = getEntityIndex();
    const { storage, paths } = getPlatform();
    const vaultRoot = await getVaultRoot();
    const entityTypes = await loadEntityTypes();
    const details = [];
    for (const id of ids) {
        // Try index first for fast lookup
        let filepath = null;
        let entityType = null;
        if (index.isBuilt) {
            for (const node of index.getNodes()) {
                if (node.id === id) {
                    filepath = node.filepath;
                    entityType = node.type;
                    break;
                }
            }
        }
        // Fallback: scan directories
        if (!filepath) {
            for (const typeConfig of entityTypes) {
                const dir = paths.join(vaultRoot, typeConfig.directory);
                try {
                    const files = await storage.readdir(dir);
                    const match = files.find(f => f.includes(`_${id}.md`) || f === `${id}.md`);
                    if (match) {
                        filepath = paths.join(dir, match);
                        entityType = typeConfig.name;
                        break;
                    }
                }
                catch { /* skip */ }
            }
        }
        if (!filepath || !entityType) {
            debug('progressive-disclosure', `Node not found: ${id}`);
            continue;
        }
        try {
            const raw = await storage.readFile(filepath, 'utf-8');
            const { meta, content } = parseEntity(filepath, raw);
            // Separate core fields from domain fields
            const fields = {};
            for (const [key, value] of Object.entries(meta)) {
                if (!CORE_FRONTMATTER_KEYS.has(key) && !key.startsWith('_')) {
                    fields[key] = value;
                }
            }
            details.push({
                id: meta.id,
                name: meta.name || meta.title || id,
                entityType,
                description: meta.description || meta.summary || undefined,
                tags: Array.isArray(meta.tags) ? meta.tags : [],
                created: meta.created || '',
                updated: meta.updated || undefined,
                fields,
                body: content,
            });
        }
        catch (err) {
            debug('progressive-disclosure', `Failed to read ${filepath}: ${err}`);
        }
    }
    return details;
}
// ─────────────────────────────────────────────────────────────────────────────
// PROGRESSIVE DISCLOSURE PHASE
// ─────────────────────────────────────────────────────────────────────────────
function formatSummariesBlock(summaries) {
    return summaries.map(s => `[${s.entityType}] ${s.name} (id:${s.id})${s.description ? ` — ${s.description}` : ''}${s.tags.length ? ` [${s.tags.join(', ')}]` : ''} created:${s.created.slice(0, 10)}`).join('\n');
}
function formatDetailsBlock(details) {
    return details.map(d => {
        const fieldLines = Object.entries(d.fields)
            .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
            .join('\n');
        return [
            `--- ${d.name} [${d.entityType}] id:${d.id} ---`,
            fieldLines,
            d.body ? `  body: ${d.body.slice(0, 400)}${d.body.length > 400 ? '…' : ''}` : '',
        ].filter(Boolean).join('\n');
    }).join('\n\n');
}
/**
 * Run the Progressive Disclosure phase.
 *
 * Returns a compact context snapshot string that replaces the full context tree
 * in the chat pipeline. Significantly reduces token usage for entity-heavy vaults.
 */
export async function runProgressiveDisclosure(llm, userInput, vaultContext, keywords) {
    if (keywords.length === 0)
        return '';
    const query = keywords.join(' ');
    let summaries = await searchSummaries(query, { limit: MAX_SUMMARIES });
    if (summaries.length === 0)
        return '';
    const collectedDetails = [];
    let contextSummary = '';
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        const summaryBlock = formatSummariesBlock(summaries);
        const detailBlock = collectedDetails.length > 0
            ? `\nNODES WITH FULL DETAIL:\n${formatDetailsBlock(collectedDetails)}\n`
            : '';
        const prompt = `You are building context for an AI assistant to answer a user request.

USER REQUEST: "${userInput}"

AVAILABLE NODE SUMMARIES (${summaries.length} matches):
${summaryBlock}
${detailBlock}
${contextSummary ? `CONTEXT SO FAR: ${contextSummary}\n` : ''}
Decide what you need:
- Request full detail on specific nodes (by id) if a summary isn't enough
- Request a new search query if you need different nodes
- Declare hasEnoughContext:true when you have what you need

Return JSON only:
{
  "needsDetail": ["id1", "id2"],
  "needsSearch": null,
  "hasEnoughContext": false,
  "contextSummary": "one sentence on what you've found so far"
}`;
        let decision;
        try {
            const raw = await llm.chat([{ role: 'user', content: prompt }], { systemPrompt: 'You are a context retrieval assistant. Respond with JSON only.', temperature: 0.1 });
            const json = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
            decision = JSON.parse(json);
        }
        catch {
            debug('progressive-disclosure', `Failed to parse disclosure decision at iteration ${iteration}`);
            break;
        }
        if (decision.contextSummary)
            contextSummary = decision.contextSummary;
        // Fetch requested detail nodes
        if (decision.needsDetail?.length > 0) {
            const newDetails = await getNodeDetails(decision.needsDetail);
            collectedDetails.push(...newDetails);
        }
        // Run a new search if requested
        if (decision.needsSearch) {
            summaries = await searchSummaries(decision.needsSearch, { limit: MAX_SUMMARIES });
        }
        if (decision.hasEnoughContext)
            break;
    }
    // Build final context snapshot
    const parts = [];
    if (summaries.length > 0) {
        parts.push(`MATCHING NODES (${summaries.length}):\n${formatSummariesBlock(summaries)}`);
    }
    if (collectedDetails.length > 0) {
        parts.push(`DETAILED NODES:\n${formatDetailsBlock(collectedDetails)}`);
    }
    if (contextSummary) {
        parts.push(`CONTEXT SUMMARY: ${contextSummary}`);
    }
    return parts.join('\n\n');
}
