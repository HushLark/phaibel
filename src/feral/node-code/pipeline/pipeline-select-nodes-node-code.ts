// ─────────────────────────────────────────────────────────────────────────────
// Pipeline NodeCode — Select Nodes (iterative catalog search)
// ─────────────────────────────────────────────────────────────────────────────
//
// Presents the catalog to the LLM via a compact overview and iterative search
// rather than dumping every node upfront.  The LLM sees ~200 tokens of group
// summaries and pulls what it needs round by round.
//
// Unlike cs_node_loop (max 5 rounds), this uses max 3 rounds since the standard
// pipeline prioritises speed.  Intent-filtered nodes are pre-surfaced so the
// LLM can often complete in a single round without any searches.
//
// Reads: user_input, __history, __gathered_context_str, __gathered_context,
//        __classification, __intent, __entity_types, __entity_index,
//        __bootstrap_runtime, __on_status
// Writes: __selected_nodes, __selected_node_details, __node_code_details,
//         __selection_reasoning, __relevance_types
// Result: ok | error
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { analyzeQueryRelevance, filterCatalogNodes } from '../../../context/query-relevance.js';
import { getTypeWithDescendants } from '../../../entities/entity-type-config.js';
import type { RelevantType } from '../../../context/query-relevance.js';
import { serializeGatheredContext } from '../../../context/context-loop.js';
import { searchCatalog, buildCatalogOverview, formatCatalogNodes } from '../../catalog/catalog-search.js';
import { getModelForCapability } from '../../../llm/router.js';
import { parseJsonResponse } from '../../../utils/json-parser.js';
import { debug } from '../../../utils/debug.js';
import { formatHistoryBlock } from '../../../commands/chat-helpers.js';
import type { ChatHistoryEntry } from '../../../commands/chat-helpers.js';
import type { ClassificationResult } from '../../../context/request-classifier.js';
import type { EntityIndex } from '../../../entities/entity-index.js';
import type { EntityTypeConfig } from '../../../entities/entity-type-config.js';
import type { FeralRuntime } from '../../bootstrap.js';
import type { GatheredContext } from '../../../context/context-loop.js';
import type { CatalogNode } from '../../catalog/catalog-node.js';

const MAX_ROUNDS = 3;

export class PipelineSelectNodesNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK,    description: 'Nodes selected via catalog search; details stored in context.' },
        { status: ResultStatus.ERROR, description: 'Runtime unavailable or LLM call failed.' },
    ];

    constructor() {
        super(
            'pipeline_select_nodes',
            'Pipeline: Select Nodes',
            'Iteratively searches the catalog and selects the minimal nodes for the request. Intent-filtered pool pre-surfaced for speed.',
            'pipeline',
        );
    }

    async process(context: Context): Promise<Result> {
        const userInput = context.getString('user_input') ?? '';
        const history = (context.get('__history') as ChatHistoryEntry[] | null) ?? [];
        const onStatus = context.get('__on_status') as ((s: string) => void) | null;
        const classification = context.get('__classification') as ClassificationResult | null;
        const entityIndex = context.get('__entity_index') as EntityIndex | null;
        const entityTypes = (context.get('__entity_types') as EntityTypeConfig[] | null) ?? [];
        const runtime = context.get('__bootstrap_runtime') as FeralRuntime | null;
        const gatheredContext = context.get('__gathered_context') as GatheredContext | null;
        const gatheredStr = context.getString('__gathered_context_str') ?? '';

        if (!runtime) {
            return this.result(ResultStatus.ERROR, 'pipeline_select_nodes requires __bootstrap_runtime in context.');
        }

        onStatus?.('Selecting capabilities…');

        // ── Build intent-relevant type list (for pre-seeding the surfaced pool) ──
        const intent = context.get('__intent') as { entityTypes?: string[] } | null;
        let intentRelevantTypes: RelevantType[] = [];
        if (intent?.entityTypes?.length) {
            // Hierarchy-aware: an intent typed at the base level ("company")
            // must also surface subtype nodes (create_customer, create_vendor) —
            // the classifier can't know which concrete subtype fits best; that's
            // this step's decision to make.
            const typeMap = new Map(entityTypes.map(t => [t.name, t]));
            const expanded = new Set(intent.entityTypes.flatMap(t => getTypeWithDescendants(t, typeMap)));
            intentRelevantTypes = [...expanded].map(t => ({
                type: t, reason: 'mentioned' as const, matchCount: 0, matchSamples: [],
            }));
        } else if (entityIndex) {
            try {
                const relevance = await analyzeQueryRelevance(userInput, entityTypes, entityIndex);
                intentRelevantTypes = relevance.relevantTypes;
            } catch { /* proceed with empty */ }
        }
        context.set('__relevance_types', intentRelevantTypes);

        const allNodes = runtime.catalog.getAllCatalogNodes();

        // ── Pre-seed the surfaced pool with intent-filtered nodes ─────────────
        // This lets the LLM select immediately in round 0 without searching.
        const intentFiltered = filterCatalogNodes(
            allNodes.filter(n => !n.key.startsWith('speak_') && !n.key.startsWith('pipeline_') && !n.key.startsWith('cs_')),
            intentRelevantTypes,
            entityTypes,
        );

        const surfacedNodes = new Map<string, CatalogNode>();
        for (const node of intentFiltered) surfacedNodes.set(node.key, node);
        debug('pipeline', `select-nodes surfaced ${surfacedNodes.size} nodes for types [${intentRelevantTypes.map(t => t.type).join(', ')}]`);
        // Always surface start + stop
        for (const key of ['start', 'stop']) {
            try { surfacedNodes.set(key, runtime.catalog.getCatalogNode(key)); } catch { /* skip */ }
        }

        const selectedKeys = new Set<string>(['start', 'stop']);
        const overview = buildCatalogOverview(allNodes);
        const historyBlock = formatHistoryBlock(history);
        const gatheredBlock = gatheredContext ? serializeGatheredContext(gatheredContext) : gatheredStr;

        const categorizeLlm = await getModelForCapability('categorize');
        let selectionReasoning = '';

        for (let round = 0; round < MAX_ROUNDS; round++) {
            const available = Array.from(surfacedNodes.values()).filter(n => !selectedKeys.has(n.key));
            const selected = Array.from(selectedKeys).map(k => surfacedNodes.get(k)).filter((n): n is CatalogNode => n != null);

            onStatus?.(`Selecting capabilities${round > 0 ? ` (round ${round + 1})` : ''}…`);

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
                        content: `Select catalog nodes for this request.

The user said: "${userInput}"
${historyBlock}
${gatheredBlock}

${overview}

AVAILABLE (pre-selected by intent filter — ready to pick):
${formatCatalogNodes(available)}

SELECTED:
${formatCatalogNodes(selected)}

Rules:
- "start" and "stop" are always included.
- Match entity types precisely — event≠task. create_event for appointments, create_task for todos.
- When creating a task or event that mentions a person by name, also select find_person AND create_person — the process should create the person if not found and link them to the new entity.
- When creating a person, also select "set_person_type" and "link_entities" if relationship context is known.
- Relationships are graph edges, not prose. When the request states a relationship between entities — a business and its store locations, its headquarters, or places it serves; a person and their employer — select nodes to create BOTH endpoints as real entities (e.g. create_company AND create_place/create_spot) PLUS "link_business_to_place" or "link_entities": one entity per endpoint, one edge per relationship. Never bury a relationship in a body sentence or a text field of one entity.
- Businesses and organizations of ANY kind — restaurants, airlines, stores, brands — use the existing business types: pick the MOST SPECIFIC one. A business the user sells to ("add X as a customer/client/account") → create_customer. A business the user buys from ("vendor", "supplier", "they provide us…") → create_vendor. Anything else → create_company. Do NOT mint a new context type for a business and do NOT file it as a note. Its physical locations are place/spot entities linked to it.
- Setting a text field like set_company_location is NOT a substitute for the graph: when the user states where a business is located or headquartered, create the place entity and link it. Example: "United Airlines is headquartered in Chicago" → select find_company + create_company + create_place + link_business_to_place (Chicago becomes a place; the edge label is "headquarters"). The location text field is at most a bonus.
- When updating a person attribute (last name, email, etc.) and the person may not exist yet, select find_person AND create_person together — route find_person's not_found edge to create_person so the contact gets created with the known details.
- For unknown content types, select "create_content_type" AND "create_entity" together.
- Select "set_context_value" to stage field values before entity creation.
- If live/external data is needed, select "perplexity_sonar".
- Search for nodes not visible in AVAILABLE above. Set "ready" when done.

Return JSON:
{
  "verdict": "ready" | "searching",
  "search_queries": ["keyword or group name if more nodes needed"],
  "select": ["node_key"],
  "deselect": ["node_key"],
  "reasoning": "Why these nodes"
}`,
                    }],
                    {
                        systemPrompt: 'Select the minimal catalog nodes for the request. Always include "start" and "stop". Prefer entity action nodes over advice.',
                        temperature: 0.3,
                    },
                );

                verdictObj = parseJsonResponse(raw) as typeof verdictObj;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (round === 0) return this.result(ResultStatus.ERROR, `Node selection failed: ${msg}`);
                break;
            }

            selectionReasoning = verdictObj.reasoning ?? selectionReasoning;

            // Apply searches
            for (const query of (verdictObj.search_queries ?? [])) {
                const { nodes: found } = searchCatalog(allNodes, query);
                for (const node of found) {
                    if (!surfacedNodes.has(node.key)) surfacedNodes.set(node.key, node);
                }
                debug('pipeline', `select-nodes search "${query}" → ${found.length} nodes`);
            }

            // Apply selections (with direct lookup fallback)
            for (const key of (verdictObj.select ?? [])) {
                if (!surfacedNodes.has(key)) {
                    try { surfacedNodes.set(key, runtime.catalog.getCatalogNode(key)); } catch { continue; }
                }
                selectedKeys.add(key);
            }

            // Apply deselections
            for (const key of (verdictObj.deselect ?? [])) {
                if (key !== 'start' && key !== 'stop') selectedKeys.delete(key);
            }

            if (verdictObj.verdict === 'ready') {
                debug('pipeline', `select-nodes done at round ${round + 1}: ${Array.from(selectedKeys).join(', ')}`);
                break;
            }
        }

        // ── Build output strings for action_loop ───────────────────────────────
        const selectedNodes = Array.from(selectedKeys)
            .map(k => surfacedNodes.get(k))
            .filter((n): n is CatalogNode => n != null);

        const selectedNodeDetails = selectedNodes
            .map(n => {
                const cfg = Object.keys(n.configuration).length > 0
                    ? `  config: ${JSON.stringify(n.configuration)}`
                    : '';
                return `- ${n.key} (${n.group}): ${n.description || n.name}${cfg}`;
            })
            .join('\n');

        const nodeCodeDetailsList: string[] = [];
        for (const n of selectedNodes) {
            try {
                const nodeCode = runtime.nodeCodeFactory.getNodeCode(n.nodeCodeKey);
                const Ctor = nodeCode.constructor as {
                    configDescriptions?: Array<{ key: string; name: string; description: string; type: string; default?: unknown; isOptional?: boolean; isSecret?: boolean }>;
                    resultDescriptions?: Array<{ status: string; description: string }>;
                };
                const configs = (Ctor.configDescriptions ?? []).filter(c => !c.isSecret);
                const results = Ctor.resultDescriptions ?? [];
                if (configs.length > 0 || results.length > 0) {
                    const configStr = configs.map(c =>
                        `    - ${c.key} (${c.type}${c.isOptional ? ', optional' : ''}${c.default != null ? `, default: ${JSON.stringify(c.default)}` : ''}): ${c.description}`
                    ).join('\n');
                    const resultStr = results.map(r => `    → "${r.status}": ${r.description}`).join('\n');
                    nodeCodeDetailsList.push(`${n.key} (nodeCode: ${n.nodeCodeKey}):\n  Configuration:\n${configStr}\n  Results (edge keys):\n${resultStr}`);
                }
            } catch { /* skip */ }
        }

        context.set('__selected_nodes', selectedNodes);
        context.set('__selected_node_details', selectedNodeDetails);
        context.set('__node_code_details', nodeCodeDetailsList.join('\n\n'));
        context.set('__selection_reasoning', selectionReasoning);

        debug('pipeline', `select-nodes final: ${selectedNodes.length} nodes — ${Array.from(selectedKeys).join(', ')}`);
        return this.result(ResultStatus.OK, `${selectedNodes.length} nodes selected.`);
    }
}
