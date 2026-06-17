// ─────────────────────────────────────────────────────────────────────────────
// Pipeline NodeCode — Select Nodes (Phase 4)
// ─────────────────────────────────────────────────────────────────────────────
//
// Presents the catalog to the LLM and asks it to pick the minimal set of nodes
// needed to fulfil the user's request.  The output is stored in context as
// pre-formatted strings that the action_loop NodeCode injects into LLM prompts.
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
import type { RelevantType } from '../../../context/query-relevance.js';
import { serializeGatheredContext } from '../../../context/context-loop.js';
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

export class PipelineSelectNodesNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK,    description: 'Nodes selected; details stored in context.' },
        { status: ResultStatus.ERROR, description: 'Node selection LLM call failed.' },
    ];

    constructor() {
        super(
            'pipeline_select_nodes',
            'Pipeline: Select Nodes',
            'Asks the categorize LLM to pick the minimal catalog nodes for the request (Phase 4).',
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

        // Build intent-relevant type list
        const intent = context.get('__intent') as { entityTypes?: string[] } | null;
        let intentRelevantTypes: RelevantType[] = [];
        if (intent?.entityTypes && intent.entityTypes.length > 0) {
            intentRelevantTypes = intent.entityTypes.map(t => ({
                type: t, reason: 'mentioned' as const, matchCount: 0, matchSamples: [],
            }));
        } else if (entityIndex) {
            try {
                const relevance = await analyzeQueryRelevance(userInput, entityTypes, entityIndex);
                intentRelevantTypes = relevance.relevantTypes;
            } catch {
                intentRelevantTypes = [];
            }
        }
        context.set('__relevance_types', intentRelevantTypes);

        // Build catalog summary
        const allNodes = runtime.catalog.getAllCatalogNodes();
        const filteredNodes = filterCatalogNodes(
            allNodes.filter(n => !n.key.startsWith('speak_') && !n.key.startsWith('pipeline_')),
            intentRelevantTypes,
            entityTypes,
        );

        const nodesByGroup = new Map<string, typeof filteredNodes>();
        for (const n of filteredNodes) {
            if (!nodesByGroup.has(n.group)) nodesByGroup.set(n.group, []);
            nodesByGroup.get(n.group)!.push(n);
        }
        const catalogSummary = Array.from(nodesByGroup.entries())
            .map(([group, nodes]) =>
                `[${group}]\n${nodes.map(n => `  ${n.key}: ${n.description || n.name}`).join('\n')}`)
            .join('\n');

        debug('pipeline', `Catalog: ${allNodes.length} total → ${filteredNodes.length} after intent filter`);

        const historyBlock = formatHistoryBlock(history);
        const gatheredBlock = gatheredContext ? serializeGatheredContext(gatheredContext) : gatheredStr;

        let phase4Response: string;
        try {
            const categorizeLlm = await getModelForCapability('categorize');
            phase4Response = await categorizeLlm.chat(
                [{
                    role: 'user' as const,
                    content: `The user said: "${userInput}"
${historyBlock}
${gatheredBlock}

Each entity type has create_*, list_*, find_*, update_*, delete_*, complete_*, set_{type}_{field} catalog nodes.
CRITICAL: Match entity types precisely — event≠task. Use create_event for appointments/meetings (including 1:1s and recurring meetings), create_task for todos.
When a person's relationship is stated, also select "set_person_type" to record it (manager/report/coworker→colleague; spouse/child/parent/sibling→family; friend→friend; vendor/client→professional) — this powers user-centric relevance.
The vault owner ("me") is itself a person node, referenceable by title "me". When a person is related TO the user (e.g. "my wife", "my son"), also use "link_entities" to link that person → "me" with the specific relationship label (spouse, son, daughter, parent, etc.) — this builds the user-centric relationship graph.
CONTENT-TYPE SPECIFICITY: when the user mentions a recurring KIND of thing in their life that an existing type doesn't capture well (a concert, a recital, a client, a 1:1, a property), prefer creating a specific-but-reusable type for it over dumping it into generic note/event — specific types carry sharper relevance. Reuse an existing type if one already fits; use the generic type only for true one-offs. Don't invent hyper-specific one-shot types ("taylor_swift_concert").
For new content types, select BOTH "create_content_type" AND "create_entity" — the type alone saves nothing; "create_entity" stores the actual item in it. Use "link_entities" to connect related entities.
For field values on creation, also select "set_context_value" to stage fields in context.

AVAILABLE CATALOG NODES:
${catalogSummary}

RULES:
- Always include "start" and "stop". Select only nodes needed for the request.
- Prefer entity nodes (create_*, complete_*, find_*) over llm_chat for data operations.
- For unknown content types, select "create_content_type" AND "create_entity" together (type without entity = lost data). For multiple entities, select multiple create_* nodes.
- Proactively link related entities. Prefer action over questions — use sensible defaults.
- When the user mentions a flight number, URL, product, or needs live/external data, include "perplexity_sonar" to look it up, then update the created/found entity with the results.

Return a JSON object with this exact structure:
{
    "reasoning": "Why these nodes were selected",
    "nodes": ["start", "stop", "node_key_1", "node_key_2"]
}

Return ONLY the JSON object, no markdown fences.`,
                }],
                {
                    systemPrompt: 'Select the minimal set of catalog nodes to fulfill the user\'s request. Always include "start" and "stop". Prefer entity actions over advice. Link related content proactively.',
                    temperature: 0.3,
                },
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return this.result(ResultStatus.ERROR, `Node selection LLM call failed: ${msg}`);
        }

        let nodeSelection: { reasoning: string; nodes: string[] };
        try {
            nodeSelection = parseJsonResponse(phase4Response) as { reasoning: string; nodes: string[] };
        } catch (err) {
            return this.result(ResultStatus.ERROR, `Failed to parse node selection: ${err instanceof Error ? err.message : err}`);
        }

        if (!nodeSelection.nodes.includes('start')) nodeSelection.nodes.unshift('start');
        if (!nodeSelection.nodes.includes('stop')) nodeSelection.nodes.push('stop');

        const selectedNodes = nodeSelection.nodes
            .map(key => {
                try { return runtime.catalog.getCatalogNode(key); } catch { return null; }
            })
            .filter(Boolean);

        const selectedNodeDetails = selectedNodes
            .map(n => {
                const config = Object.keys(n!.configuration).length > 0
                    ? `  config: ${JSON.stringify(n!.configuration)}`
                    : '';
                return `- ${n!.key} (${n!.group}): ${n!.description || n!.name}${config}`;
            })
            .join('\n');

        const nodeCodeDetailsList: string[] = [];
        for (const n of selectedNodes) {
            if (!n) continue;
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
        context.set('__selection_reasoning', nodeSelection.reasoning);

        debug('pipeline', `Selected ${selectedNodes.length} nodes: ${nodeSelection.nodes.join(', ')}`);
        return this.result(ResultStatus.OK, `${selectedNodes.length} nodes selected.`);
    }
}
