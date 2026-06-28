// ─────────────────────────────────────────────────────────────────────────────
// Catalog Search
// ─────────────────────────────────────────────────────────────────────────────
//
// Utilities for presenting the catalog to an LLM iteratively rather than
// dumping all nodes at once.  Pattern:
//
//   1. buildCatalogOverview() → groups with counts (~200 tokens)
//   2. LLM requests: searchCatalog(nodes, query) → matching nodes
//   3. LLM selects from surfaced nodes; loop until verdict = "ready"
//
// This mirrors the context-loop pattern: the LLM pulls what it needs
// rather than receiving everything upfront.
// ─────────────────────────────────────────────────────────────────────────────

import type { CatalogNode } from './catalog-node.js';

// Groups that should never be surfaced to the process-design LLM
const EXCLUDED_GROUPS = new Set(['pipeline']);

// Curated one-line descriptions per group (shown in the overview)
const GROUP_DESCRIPTIONS: Record<string, string> = {
    entity:   'create_*, find_*, list_*, update_*, delete_*, complete_*, set_{type}_{field} for every entity type',
    flow:     'start, stop, array_iterator (loop), sub_process, run_inline_process, set_context_value, comparator',
    llm:      'llm_chat, perplexity_sonar (web search + citations), weather, token usage',
    output:   'agent_speak, generate_markdown, generate_html',
    genai:    'write_entity, write_file, merge_strings, hydrate_model, model_to_output',
    skill:    'user-defined skills (search "skill" to see all)',
    slack:    'slack_post_webhook, slack_block_builder, slash command handler',
    system:   'cli_command, introspect, analytics, list_processes, list_catalog_nodes',
    pamp:     'PAMP agent-to-agent messaging (send, inbox, share, await reply)',
    a2a:      'A2A agent task delegation',
    fcp:      'FCP context protocol (probe, fetch)',
    cxf:      'CXF data exchange (discover, pull, push)',
    pipeline: '(internal pipeline orchestration — do not use in generated processes)',
};

export interface CatalogSearchResult {
    nodes: CatalogNode[];
    query: string;
    totalMatches: number;
}

/**
 * Fuzzy search across catalog nodes.  Scores by key, group, name, and description.
 * Automatically excludes pipeline-internal nodes.
 */
export function searchCatalog(
    nodes: CatalogNode[],
    query: string,
    limit = 25,
): CatalogSearchResult {
    const q = query.toLowerCase().trim();
    if (!q) return { nodes: [], query, totalMatches: 0 };

    const scored = nodes
        .filter(n => !EXCLUDED_GROUPS.has(n.group))
        .map(node => {
            const key = node.key.toLowerCase();
            const name = node.name.toLowerCase();
            const desc = (node.description ?? '').toLowerCase();
            const group = node.group.toLowerCase();

            let score = 0;
            // Exact key match is the strongest signal
            if (key === q) score += 100;
            else if (key.startsWith(q + '_') || key.startsWith(q)) score += 60;
            else if (key.includes(q)) score += 25;
            // Group match (e.g. query "entity" or "flow")
            if (group === q) score += 50;
            else if (group.includes(q)) score += 20;
            // Name / description secondary
            if (name.includes(q)) score += 15;
            if (desc.includes(q)) score += 5;

            return { node, score };
        })
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score);

    return {
        nodes: scored.slice(0, limit).map(({ node }) => node),
        query,
        totalMatches: scored.length,
    };
}

/**
 * Build a compact catalog overview for the initial LLM prompt.
 * Shows groups with node counts and curated descriptions — not individual nodes.
 * Typically ~200 tokens vs. 2000+ for the full catalog dump.
 */
export function buildCatalogOverview(nodes: CatalogNode[]): string {
    const groupMap = new Map<string, CatalogNode[]>();
    for (const node of nodes) {
        if (!groupMap.has(node.group)) groupMap.set(node.group, []);
        groupMap.get(node.group)!.push(node);
    }

    const userFacingTotal = nodes.filter(n => !EXCLUDED_GROUPS.has(n.group)).length;
    const lines = [`CATALOG (${userFacingTotal} available nodes):`];

    // Sort: entity first (largest + most commonly needed), pipeline last
    const sorted = Array.from(groupMap.entries())
        .filter(([g]) => !EXCLUDED_GROUPS.has(g))
        .sort(([a, aN], [b, bN]) => {
            if (a === 'entity') return -1;
            if (b === 'entity') return 1;
            return bN.length - aN.length;
        });

    for (const [group, groupNodes] of sorted) {
        const desc = GROUP_DESCRIPTIONS[group] ?? groupNodes.slice(0, 4).map(n => n.key).join(', ');
        const count = String(groupNodes.length).padStart(3);
        lines.push(`  [${group}] ${count} nodes — ${desc}`);
    }

    lines.push('\nSearch by group name (e.g. "entity", "flow") or keyword (e.g. "task", "create", "link", "search").');

    return lines.join('\n');
}

/**
 * Format a list of nodes for display in an LLM prompt.
 */
export function formatCatalogNodes(nodes: CatalogNode[]): string {
    if (nodes.length === 0) return '(none)';
    return nodes.map(n => `  ${n.key} [${n.group}]: ${n.description || n.name}`).join('\n');
}
