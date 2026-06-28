// ─────────────────────────────────────────────────────────────────────────────
// Cruel Summer Pipeline — Step 4: Get Process Nodes (iterative catalog search)
// ─────────────────────────────────────────────────────────────────────────────
//
// Selects catalog nodes using an iterative search loop instead of sending the
// full catalog upfront.  The LLM receives a compact catalog overview (~200
// tokens) and pulls what it needs via search queries, then selects and
// deselects until satisfied.
//
// Pattern mirrors cs_context_loop:
//   Round 0: overview only, nothing surfaced yet — LLM must search
//   Round N: overview + surfaced pool + current selection
//   Verdict "ready" → done | max rounds → done with best selection
//
// Reads: user_input, __gathered_context_str, __cs_success_statement,
//        __cs_success_checklist, __entity_types, __entity_index,
//        __bootstrap_runtime, __on_status
// Writes: __selected_nodes, __selected_node_details, __node_code_details,
//         __selection_reasoning
// Result: ok | error
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { searchCatalog, buildCatalogOverview, formatCatalogNodes } from '../../catalog/catalog-search.js';
import { getModelForCapability } from '../../../llm/router.js';
import { parseJsonResponse } from '../../../utils/json-parser.js';
import { debug } from '../../../utils/debug.js';
import type { EntityTypeConfig } from '../../../entities/entity-type-config.js';
import type { FeralRuntime } from '../../bootstrap.js';
import type { CatalogNode } from '../../catalog/catalog-node.js';

const MAX_LOOPS = 5;

export class CSNodeLoopNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK,    description: 'Nodes selected via iterative catalog search.' },
        { status: ResultStatus.ERROR, description: 'Runtime unavailable or initial search failed.' },
    ];

    constructor() {
        super(
            'cs_node_loop',
            'CS: Get Nodes (catalog search loop)',
            'Iteratively searches the catalog and selects nodes. LLM requests what it needs rather than receiving every node. Step 4 of Cruel Summer.',
            'pipeline',
        );
    }

    async process(context: Context): Promise<Result> {
        const userInput = context.getString('user_input') ?? '';
        const gatheredStr = context.getString('__gathered_context_str') ?? '';
        const successStatement = context.getString('__cs_success_statement') ?? '';
        const successChecklist = (context.get('__cs_success_checklist') as string[] | null) ?? [];
        const onStatus = context.get('__on_status') as ((s: string) => void) | null;

        const entityTypes = (context.get('__entity_types') as EntityTypeConfig[] | null) ?? [];
        const runtime = context.get('__bootstrap_runtime') as FeralRuntime | null;

        if (!runtime) {
            return this.result(ResultStatus.ERROR, 'cs_node_loop requires __bootstrap_runtime in context.');
        }

        onStatus?.('Finding capabilities…');

        const allNodes = runtime.catalog.getAllCatalogNodes();
        const overview = buildCatalogOverview(allNodes);

        // Track what has been surfaced to the LLM (search results pool)
        const surfacedNodes = new Map<string, CatalogNode>();
        // Always surface start + stop immediately
        for (const key of ['start', 'stop']) {
            try { surfacedNodes.set(key, runtime.catalog.getCatalogNode(key)); } catch { /* skip */ }
        }

        // Current selection (keys)
        const selectedKeys = new Set<string>(['start', 'stop']);

        const successBlock = successStatement
            ? `SUCCESS CRITERIA:\n${successStatement}\n${successChecklist.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}`
            : '';

        const categorizeLlm = await getModelForCapability('categorize');
        let selectionReasoning = '';

        for (let round = 0; round < MAX_LOOPS; round++) {
            const available = Array.from(surfacedNodes.values()).filter(n => !selectedKeys.has(n.key));
            const selected = Array.from(selectedKeys).map(k => surfacedNodes.get(k)).filter((n): n is CatalogNode => n != null);

            const isFirstRound = round === 0;
            onStatus?.(`Searching catalog${round > 0 ? ` (round ${round + 1})` : ''}…`);

            let verdictObj: {
                verdict: 'ready' | 'searching';
                search_queries?: string[];
                select?: string[];
                deselect?: string[];
                reasoning?: string;
            };

            try {
                const raw = await categorizeLlm.chat(
                    [{
                        role: 'user' as const,
                        content: `Select catalog nodes to handle this request.

USER REQUEST: "${userInput}"
${successBlock}
${gatheredStr}

${overview}

SURFACED (found via search — available to select):
${isFirstRound ? '(none yet — search to find nodes)' : formatCatalogNodes(available)}

SELECTED:
${formatCatalogNodes(selected)}

${isFirstRound
    ? 'Search the catalog first to find relevant nodes. Use search_queries to look up what you need.'
    : 'You can search for more, select from SURFACED, deselect wrong choices, or confirm ready.'}

RULES:
- "start" and "stop" are always included — do not remove them.
- Prefer entity action nodes (create_*, find_*, complete_*) over llm_chat for data.
- Only select nodes actually needed — fewer is better.
- If you know a node key, you can select it directly even if not yet surfaced.
- When creating a task or event that mentions a person by name, also select find_person AND create_person — create the contact if not found, then link them.
- When updating a person attribute and the person may not exist yet, select find_person AND create_person — route not_found to create_person so the contact gets created.
- Set verdict "ready" only when the selection is complete.

Return JSON:
{
  "verdict": "ready" | "searching",
  "search_queries": ["group name or keyword to search"],
  "select": ["node_key_to_add"],
  "deselect": ["node_key_to_remove"],
  "reasoning": "One sentence"
}`,
                    }],
                    {
                        systemPrompt: 'Select the minimal set of catalog nodes for the request. Search by group or keyword. Prefer entity action nodes. "start" and "stop" are always included.',
                        temperature: 0.3,
                    },
                );

                verdictObj = parseJsonResponse(raw) as typeof verdictObj;
            } catch (err) {
                debug('pipeline', `CS node-loop round ${round + 1} failed: ${err}`);
                if (selectedKeys.size > 2) break; // Have selections beyond start/stop — use them
                return this.result(ResultStatus.ERROR, `Catalog search LLM call failed: ${err instanceof Error ? err.message : err}`);
            }

            selectionReasoning = verdictObj.reasoning ?? selectionReasoning;

            // ── Apply search queries ───────────────────────────────────────────
            for (const query of (verdictObj.search_queries ?? [])) {
                const { nodes: found } = searchCatalog(allNodes, query);
                for (const node of found) {
                    if (!surfacedNodes.has(node.key)) {
                        surfacedNodes.set(node.key, node);
                    }
                }
                debug('pipeline', `CS node-loop search "${query}" → ${found.length} nodes`);
            }

            // ── Apply selections (select from surfaced pool, or look up directly) ──
            for (const key of (verdictObj.select ?? [])) {
                if (!surfacedNodes.has(key)) {
                    // Try direct lookup — LLM may know a key without having searched for it
                    try {
                        surfacedNodes.set(key, runtime.catalog.getCatalogNode(key));
                    } catch { continue; }
                }
                selectedKeys.add(key);
            }

            // ── Apply deselections (never remove start/stop) ──────────────────
            for (const key of (verdictObj.deselect ?? [])) {
                if (key !== 'start' && key !== 'stop') selectedKeys.delete(key);
            }

            if (verdictObj.verdict === 'ready') {
                debug('pipeline', `CS node-loop done at round ${round + 1}: ${Array.from(selectedKeys).join(', ')}`);
                break;
            }
        }

        // ── Build output strings for cs_build_process ──────────────────────────
        const selectedNodes = Array.from(selectedKeys)
            .map(k => surfacedNodes.get(k))
            .filter((n): n is CatalogNode => n != null);

        const selectedNodeDetails = selectedNodes
            .map(n => {
                const cfg = Object.keys(n.configuration).length > 0
                    ? `  config: ${JSON.stringify(n.configuration)}`
                    : '';
                return `- ${n.key} [${n.group}]: ${n.description || n.name}${cfg}`;
            })
            .join('\n');

        const nodeCodeDetailsList: string[] = [];
        for (const n of selectedNodes) {
            try {
                const nodeCode = runtime.nodeCodeFactory.getNodeCode(n.nodeCodeKey);
                const Ctor = nodeCode.constructor as {
                    configDescriptions?: Array<{ key: string; type: string; description: string; isOptional?: boolean; isSecret?: boolean; default?: unknown }>;
                    resultDescriptions?: Array<{ status: string; description: string }>;
                };
                const configs = (Ctor.configDescriptions ?? []).filter(c => !c.isSecret);
                const results = Ctor.resultDescriptions ?? [];
                if (configs.length > 0 || results.length > 0) {
                    const configStr = configs.map(c =>
                        `    - ${c.key} (${c.type}${c.isOptional ? ', optional' : ''}): ${c.description}`
                    ).join('\n');
                    const resultStr = results.map(r => `    → "${r.status}": ${r.description}`).join('\n');
                    nodeCodeDetailsList.push(`${n.key} (nodeCode: ${n.nodeCodeKey}):\n  Config:\n${configStr}\n  Results:\n${resultStr}`);
                }
            } catch { /* skip */ }
        }

        context.set('__selected_nodes', selectedNodes);
        context.set('__selected_node_details', selectedNodeDetails);
        context.set('__node_code_details', nodeCodeDetailsList.join('\n\n'));
        context.set('__selection_reasoning', selectionReasoning);

        void entityTypes; // available if needed for future relevance filtering
        debug('pipeline', `CS node-loop final: ${selectedNodes.length} nodes — ${Array.from(selectedKeys).join(', ')}`);
        return this.result(ResultStatus.OK, `${selectedNodes.length} nodes selected.`);
    }
}
