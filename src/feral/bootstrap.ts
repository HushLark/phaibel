// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Bootstrap
// ─────────────────────────────────────────────────────────────────────────────
//
// Wires the full Feral runtime from configuration.
// Call bootstrapFeral() once at service/CLI startup.
// ─────────────────────────────────────────────────────────────────────────────

import path from 'path';
import { findVaultRoot } from '../state/manager.js';
import { getProcessesDir } from '../paths.js';

import { NodeCodeFactory } from './node-code/node-code-factory.js';
import type { NodeCode } from './node-code/node-code.js';
import { Catalog } from './catalog/catalog.js';
import { BuiltInCatalogSource } from './catalog/built-in-catalog-source.js';
import { JsonCatalogSource } from './catalog/json-catalog-source.js';
import { loadFeralCatalogConfig } from './catalog/feral-catalog-config.js';
import { EventDispatcher } from './events/event-dispatcher.js';
import { ProcessEngine } from './engine/process-engine.js';
import { ProcessFactory } from './process/process-factory.js';
import { Runner } from './runner/runner.js';
import { FeralToolRegistry } from './feral-tool-registry.js';
import type { ProcessSource } from './process/process-factory.js';
import type { Process } from './process/process.js';

// Built-in node codes
import { StartNodeCode } from './node-code/flow/start-node-code.js';
import { StopNodeCode } from './node-code/flow/stop-node-code.js';
import { NoopNodeCode } from './node-code/flow/noop-node-code.js';
import { ComparatorNodeCode } from './node-code/flow/comparator-node-code.js';
import { ContextValueResultNodeCode } from './node-code/flow/context-value-result-node-code.js';
import { ArrayIteratorNodeCode } from './node-code/flow/array-iterator-node-code.js';
import { ThrowExceptionNodeCode } from './node-code/flow/throw-exception-node-code.js';
import { SubProcessNodeCode } from './node-code/flow/sub-process-node-code.js';
import { SetContextValueNodeCode } from './node-code/data/set-context-value-node-code.js';
import { SetContextTableNodeCode } from './node-code/data/set-context-table-node-code.js';
import { CalculationNodeCode } from './node-code/data/calculation-node-code.js';
import { CounterNodeCode } from './node-code/data/counter-node-code.js';
import { HttpNodeCode } from './node-code/data/http-node-code.js';
import { JsonDecodeNodeCode } from './node-code/data/json-decode-node-code.js';
import { JsonEncodeNodeCode } from './node-code/data/json-encode-node-code.js';
import { LogNodeCode } from './node-code/data/log-node-code.js';
import { RandomValueNodeCode } from './node-code/data/random-value-node-code.js';
import { ReadFileNodeCode } from './node-code/data/read-file-node-code.js';
import { LlmChatNodeCode } from './node-code/data/llm-chat-node-code.js';
import { CleanLlmJsonNodeCode } from './node-code/data/clean-llm-json-node-code.js';
import { WeatherNodeCode } from './node-code/data/weather-node-code.js';
import { QueryTokenUsageNodeCode } from './node-code/data/query-token-usage-node-code.js';
import { ChartTokenUsageNodeCode } from './node-code/data/chart-token-usage-node-code.js';

// Slack node codes
import { SlackBlockBuilderNodeCode } from './node-code/slack/slack-block-builder-node-code.js';
import { SlackPostWebhookNodeCode } from './node-code/slack/slack-post-webhook-node-code.js';
import { SlackProcessSlashCommandNodeCode } from './node-code/slack/slack-process-slash-command-node-code.js';

// Agent / GenAI node codes
import { MergeStringsNodeCode } from './node-code/genai/merge-strings-node-code.js';
import { DataSynthesisPrepNodeCode } from './node-code/genai/data-synthesis-prep-node-code.js';
import { WriteFileNodeCode } from './node-code/genai/write-file-node-code.js';
import { GenerateMarkdownNodeCode } from './node-code/genai/generate-markdown-node-code.js';
import { GenerateHtmlNodeCode } from './node-code/genai/generate-html-node-code.js';
import { WriteEntityNodeCode } from './node-code/genai/write-entity-node-code.js';
import { WriteToRedisNodeCode } from './node-code/genai/write-to-redis-node-code.js';
import { OpenAiNodeCode } from './node-code/genai/openai-node-code.js';
import { ModelToOutputNodeCode } from './node-code/genai/model-to-output-node-code.js';
import { HydrateModelNodeCode } from './node-code/genai/hydrate-model-node-code.js';

// Entity node codes
import { ListEntitiesNodeCode } from './node-code/entity/list-entities-node-code.js';
import { FindEntityNodeCode } from './node-code/entity/find-entity-node-code.js';
import { CreateEntityNodeCode } from './node-code/entity/create-entity-node-code.js';
import { CreateEntityTypeNodeCode } from './node-code/entity/create-entity-type-node-code.js';
import { ListEntityTypesNodeCode } from './node-code/entity/list-entity-types-node-code.js';
import { UpdateEntityTypeNodeCode } from './node-code/entity/update-entity-type-node-code.js';
import { DeleteEntityTypeNodeCode } from './node-code/entity/delete-entity-type-node-code.js';
import { SetEntityFieldNodeCode } from './node-code/entity/set-entity-field-node-code.js';
import { UpdateEntityNodeCode } from './node-code/entity/update-entity-node-code.js';
import { DeleteEntityNodeCode } from './node-code/entity/delete-entity-node-code.js';
import { CompleteEntityNodeCode } from './node-code/entity/complete-entity-node-code.js';
import { SortEntitiesNodeCode } from './node-code/entity/sort-entities-node-code.js';
import { LoadVaultContextNodeCode } from './node-code/entity/load-vault-context-node-code.js';
import { CreateRecurringTaskNodeCode } from './node-code/entity/create-recurring-task-node-code.js';
import { SearchEntitiesNodeCode } from './node-code/entity/search-entities-node-code.js';
import { LinkEntitiesNodeCode } from './node-code/entity/link-entities-node-code.js';

// MCP & A2A node codes
import { McpCallToolNodeCode } from './node-code/mcp/mcp-call-tool-node-code.js';
import { A2ASendTaskNodeCode } from './node-code/a2a/a2a-send-task-node-code.js';
import { PampSendNodeCode } from './node-code/pamp/pamp-send-node-code.js';
import { PampCheckInboxNodeCode } from './node-code/pamp/pamp-check-inbox-node-code.js';
import { PampShareEntityNodeCode } from './node-code/pamp/pamp-share-entity-node-code.js';
import { PampAwaitReplyNodeCode } from './node-code/pamp/pamp-await-reply-node-code.js';

// Catalog sources
import { SlackCatalogSource } from './catalog/slack-catalog-source.js';
import { AgentCatalogSource } from './catalog/agent-catalog-source.js';
import { EntityCatalogSource } from './catalog/entity-catalog-source.js';
import { SystemCatalogSource } from './catalog/system-catalog-source.js';
import { OutputCatalogSource } from './catalog/output-catalog-source.js';
import { IntrospectCatalogSource } from './catalog/introspect-catalog-source.js';
import { PampCatalogSource } from './catalog/pamp-catalog-source.js';
import { McpCatalogSource } from './catalog/mcp-catalog-source.js';
import { A2ACatalogSource } from './catalog/a2a-catalog-source.js';
import { UsageCatalogSource } from './catalog/usage-catalog-source.js';

// System & output node codes
import { CliCommandNodeCode } from './node-code/system/cli-command-node-code.js';
import { IntrospectNodeCode } from './node-code/system/introspect-node-code.js';
import { ListProcessesNodeCode } from './node-code/system/list-processes-node-code.js';
import { ListCatalogNodesNodeCode } from './node-code/system/list-catalog-nodes-node-code.js';
import { AgentSpeakNodeCode } from './node-code/output/agent-speak-node-code.js';

// Input node codes
import { PromptInputNodeCode } from './node-code/input/prompt-input-node-code.js';
import { PromptSelectNodeCode } from './node-code/input/prompt-select-node-code.js';

// Process sources
import { JsonProcessSource } from './process/json-process-source.js';

// Entity type schema
import { loadEntityTypes } from '../entities/entity-type-config.js';
import { getTrackedModels } from '../llm/token-usage.js';

/**
 * All built-in NodeCode instances.
 */
function getBuiltInNodeCodes(): NodeCode[] {
    return [
        // Flow
        new StartNodeCode(),
        new StopNodeCode(),
        new NoopNodeCode(),
        new ComparatorNodeCode(),
        new ContextValueResultNodeCode(),
        new ArrayIteratorNodeCode(),
        new ThrowExceptionNodeCode(),
        new SubProcessNodeCode(),
        // Data
        new SetContextValueNodeCode(),
        new SetContextTableNodeCode(),
        new CalculationNodeCode(),
        new CounterNodeCode(),
        new HttpNodeCode(),
        new JsonDecodeNodeCode(),
        new JsonEncodeNodeCode(),
        new LogNodeCode(),
        new RandomValueNodeCode(),
        new ReadFileNodeCode(),
        new LlmChatNodeCode(),
        new CleanLlmJsonNodeCode(),
        new WeatherNodeCode(),
        new QueryTokenUsageNodeCode(),
        new ChartTokenUsageNodeCode(),
        // Slack
        new SlackBlockBuilderNodeCode(),
        new SlackPostWebhookNodeCode(),
        new SlackProcessSlashCommandNodeCode(),
        // Agent / GenAI
        new MergeStringsNodeCode(),
        new DataSynthesisPrepNodeCode(),
        new WriteFileNodeCode(),
        new GenerateMarkdownNodeCode(),
        new GenerateHtmlNodeCode(),
        new WriteEntityNodeCode(),
        new WriteToRedisNodeCode(),
        new OpenAiNodeCode(),
        new ModelToOutputNodeCode(),
        new HydrateModelNodeCode(),
        // Entity
        new ListEntitiesNodeCode(),
        new FindEntityNodeCode(),
        new CreateEntityNodeCode(),
        new CreateEntityTypeNodeCode(),
        new ListEntityTypesNodeCode(),
        new UpdateEntityTypeNodeCode(),
        new DeleteEntityTypeNodeCode(),
        new UpdateEntityNodeCode(),
        new SetEntityFieldNodeCode(),
        new DeleteEntityNodeCode(),
        new CompleteEntityNodeCode(),
        new SortEntitiesNodeCode(),
        new LoadVaultContextNodeCode(),
        new CreateRecurringTaskNodeCode(),
        new SearchEntitiesNodeCode(),
        new LinkEntitiesNodeCode(),
        // System & output
        new CliCommandNodeCode(),
        new IntrospectNodeCode(),
        new AgentSpeakNodeCode(),
        // Input
        new PromptInputNodeCode(),
        new PromptSelectNodeCode(),
        // PAMP
        new PampSendNodeCode(),
        new PampCheckInboxNodeCode(),
        new PampShareEntityNodeCode(),
        new PampAwaitReplyNodeCode(),
        // MCP
        new McpCallToolNodeCode(),
        // A2A
        new A2ASendTaskNodeCode(),
    ];
}

/**
 * The assembled Feral runtime, ready to execute processes.
 */
export interface FeralRuntime {
    readonly nodeCodeFactory: NodeCodeFactory;
    readonly catalog: Catalog;
    readonly eventDispatcher: EventDispatcher;
    readonly engine: ProcessEngine;
    readonly processFactory: ProcessFactory;
    readonly runner: Runner;
    readonly toolRegistry: FeralToolRegistry;
    readonly vaultProcesses: Process[];
}

/**
 * Bootstrap the full Feral runtime:
 * 1. Creates NodeCodeFactory with all built-in node codes
 * 2. Loads user-defined catalog config from ~/.phaibel/feral-catalog.json
 * 3. Builds Catalog from built-in + user-defined sources
 * 4. Wires EventDispatcher, ProcessEngine, ProcessFactory, Runner
 */
export async function bootstrapFeral(
    processSources: ProcessSource[] = [],
): Promise<FeralRuntime> {
    // 1. NodeCode factory
    const nodeCodeFactory = new NodeCodeFactory([
        { getNodeCodes: () => getBuiltInNodeCodes() },
    ]);

    // 2. Load catalog config, entity types, MCP tools, and A2A agents (parallel — independent)
    const { mcpManager } = await import('../skills/mcp-manager.js');
    const { a2aClient } = await import('../agents/a2a-client.js');
    const [catalogConfig, entityTypes, mcpTools, a2aAgents, trackedModels] = await Promise.all([
        loadFeralCatalogConfig(),
        loadEntityTypes(),
        mcpManager.discoverAllTools(),
        a2aClient.discoverAllAgents(),
        getTrackedModels(),
    ]);

    // 3. Build catalog from all sources
    const catalog = new Catalog([
        new BuiltInCatalogSource(nodeCodeFactory),
        new JsonCatalogSource(catalogConfig),
        new SlackCatalogSource(),
        new AgentCatalogSource(),
        new EntityCatalogSource(entityTypes),
        new SystemCatalogSource(),
        new OutputCatalogSource(),
        new IntrospectCatalogSource(),
        new PampCatalogSource(),
        new McpCatalogSource(mcpTools),
        new A2ACatalogSource(a2aAgents),
        new UsageCatalogSource(trackedModels),
    ]);

    // 4. Load process definitions from {vault}/.phaibel/processes/
    const processDir = await getProcessesDir();
    const jsonProcessSource = new JsonProcessSource(processDir);
    await jsonProcessSource.load();

    // 4b. Load vault-root process definitions from {vaultRoot}/processes/
    const vaultRoot = await findVaultRoot();
    const vaultProcessSource = new JsonProcessSource(path.join(vaultRoot ?? '', 'processes'));
    await vaultProcessSource.load(); // silently handles missing dir
    const vaultProcesses: Process[] = vaultProcessSource.getProcesses();

    // 5. Wire engine
    const eventDispatcher = new EventDispatcher();
    const engine = new ProcessEngine(eventDispatcher, catalog, nodeCodeFactory);
    const processFactory = new ProcessFactory([jsonProcessSource, vaultProcessSource, ...processSources]);
    const runner = new Runner(processFactory, engine);

    // 6. Late-registered node codes (depend on processFactory / catalog)
    nodeCodeFactory.register(new ListProcessesNodeCode(processFactory));
    nodeCodeFactory.register(new ListCatalogNodesNodeCode(catalog));

    // 7. Tool registry — auto-generates ServiceTools from process metadata
    const toolRegistry = new FeralToolRegistry(processFactory, runner);

    return {
        nodeCodeFactory,
        catalog,
        eventDispatcher,
        engine,
        processFactory,
        runner,
        toolRegistry,
        vaultProcesses,
    };
}
