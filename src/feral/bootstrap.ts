// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Bootstrap
// ─────────────────────────────────────────────────────────────────────────────
//
// Wires the full Feral runtime from configuration.
// Call bootstrapFeral() once at service/CLI startup.
// ─────────────────────────────────────────────────────────────────────────────

import { getPlatform } from '../platform/index.js';
import { findVaultRoot } from '../state/manager.js';
import { getProcessesDir, getFeralProcessesDir } from '../paths.js';

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

// ── Cross-platform node codes (safe for both Node.js and mobile) ─────────
import { StartNodeCode } from './node-code/flow/start-node-code.js';
import { StopNodeCode } from './node-code/flow/stop-node-code.js';
import { NoopNodeCode } from './node-code/flow/noop-node-code.js';
import { ComparatorNodeCode } from './node-code/flow/comparator-node-code.js';
import { ContextValueResultNodeCode } from './node-code/flow/context-value-result-node-code.js';
import { ArrayIteratorNodeCode } from './node-code/flow/array-iterator-node-code.js';
import { ThrowExceptionNodeCode } from './node-code/flow/throw-exception-node-code.js';
import { SubProcessNodeCode } from './node-code/flow/sub-process-node-code.js';
import { RunSkillNodeCode } from './node-code/flow/run-skill-node-code.js';
import { RunInlineProcessNodeCode } from './node-code/flow/run-inline-process-node-code.js';
import { SetContextValueNodeCode } from './node-code/data/set-context-value-node-code.js';
import { SetContextTableNodeCode } from './node-code/data/set-context-table-node-code.js';
import { CalculationNodeCode } from './node-code/data/calculation-node-code.js';
import { CounterNodeCode } from './node-code/data/counter-node-code.js';
import { HttpNodeCode } from './node-code/data/http-node-code.js';
import { JsonDecodeNodeCode } from './node-code/data/json-decode-node-code.js';
import { JsonEncodeNodeCode } from './node-code/data/json-encode-node-code.js';
import { LogNodeCode } from './node-code/data/log-node-code.js';
import { RandomValueNodeCode } from './node-code/data/random-value-node-code.js';
import { LlmChatNodeCode } from './node-code/data/llm-chat-node-code.js';
import { CleanLlmJsonNodeCode } from './node-code/data/clean-llm-json-node-code.js';
import { WeatherNodeCode } from './node-code/data/weather-node-code.js';
import { WebSearchNodeCode } from './node-code/data/web-search-node-code.js';
import { QueryTokenUsageNodeCode } from './node-code/data/query-token-usage-node-code.js';
import { ChartTokenUsageNodeCode } from './node-code/data/chart-token-usage-node-code.js';
import { MergeStringsNodeCode } from './node-code/genai/merge-strings-node-code.js';
import { DataSynthesisPrepNodeCode } from './node-code/genai/data-synthesis-prep-node-code.js';
import { GenerateMarkdownNodeCode } from './node-code/genai/generate-markdown-node-code.js';
import { GenerateHtmlNodeCode } from './node-code/genai/generate-html-node-code.js';
import { WriteEntityNodeCode } from './node-code/genai/write-entity-node-code.js';
import { OpenAiNodeCode } from './node-code/genai/openai-node-code.js';
import { ModelToOutputNodeCode } from './node-code/genai/model-to-output-node-code.js';
import { HydrateModelNodeCode } from './node-code/genai/hydrate-model-node-code.js';
import { ListEntitiesNodeCode } from './node-code/context/list-entities-node-code.js';
import { FindEntityNodeCode } from './node-code/context/find-entity-node-code.js';
import { CreateEntityNodeCode } from './node-code/context/create-entity-node-code.js';
import { CreateEntityTypeNodeCode } from './node-code/context/create-entity-type-node-code.js';
import { ListEntityTypesNodeCode } from './node-code/context/list-entity-types-node-code.js';
import { UpdateEntityTypeNodeCode } from './node-code/context/update-entity-type-node-code.js';
import { DeleteEntityTypeNodeCode } from './node-code/context/delete-entity-type-node-code.js';
import { SetEntityFieldNodeCode } from './node-code/context/set-entity-field-node-code.js';
import { UpdateEntityNodeCode } from './node-code/context/update-entity-node-code.js';
import { DeleteEntityNodeCode } from './node-code/context/delete-entity-node-code.js';
import { CompleteEntityNodeCode } from './node-code/context/complete-entity-node-code.js';
import { SortEntitiesNodeCode } from './node-code/context/sort-entities-node-code.js';
import { LoadVaultContextNodeCode } from './node-code/context/load-vault-context-node-code.js';
import { CreateRecurringTaskNodeCode } from './node-code/context/create-recurring-task-node-code.js';
import { SearchEntitiesNodeCode } from './node-code/context/search-entities-node-code.js';
import { LinkEntitiesNodeCode } from './node-code/context/link-entities-node-code.js';
import { AgentSpeakNodeCode } from './node-code/output/agent-speak-node-code.js';
import { HtmlToMarkdownNodeCode } from './node-code/data/html-to-markdown-node-code.js';
import { PromptInputNodeCode } from './node-code/input/prompt-input-node-code.js';
import { PromptSelectNodeCode } from './node-code/input/prompt-select-node-code.js';

// ── Pipeline NodeCodes (Node.js only — use dynamic import to stay mobile-safe) ──
// Imported in getNodeOnlyNodeCodes() below.

// ── Cross-platform catalog sources ───────────────────────────────────────
import { EntityCatalogSource } from './catalog/entity-catalog-source.js';
import { LifePrimitivesCatalogSource } from './catalog/life-primitives-catalog-source.js';
import { PipelineCatalogSource } from './pipelines/pipeline-catalog-source.js';
import { OutputCatalogSource } from './catalog/output-catalog-source.js';
import { UsageCatalogSource } from './catalog/usage-catalog-source.js';
import { SkillCatalogSource } from './catalog/skill-catalog-source.js';

// ── System node codes (cross-platform) ──────────────────────────────────
import { ListProcessesNodeCode } from './node-code/system/list-processes-node-code.js';
import { ListCatalogNodesNodeCode } from './node-code/system/list-catalog-nodes-node-code.js';
import { AnalyticsNodeCode } from './node-code/system/analytics-node-code.js';

// Process sources
import { JsonProcessSource } from './process/json-process-source.js';
import { PipelineProcessSource } from './pipelines/pipeline-process-source.js';

// Entity type schema
import { loadEntityTypes } from '../entities/entity-type-config.js';
import { getTrackedModels } from '../llm/token-usage.js';

// ── Node-only imports are loaded dynamically in getNodeOnlyNodeCodes() ───
// Slack, A2A, PAMP, Scheduler, CLI, Introspect, ReadFile, WriteFile,
// WriteToRedis — these transitively depend on Node.js built-ins and must
// NOT be statically imported so Metro (Expo) doesn't trace them.

/**
 * Cross-platform NodeCode instances (safe for both Node.js and mobile).
 */
function getCrossPlatformNodeCodes(): NodeCode[] {
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
        new RunSkillNodeCode(),
        new RunInlineProcessNodeCode(),
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
        new LlmChatNodeCode(),
        new CleanLlmJsonNodeCode(),
        new WeatherNodeCode(),
        new WebSearchNodeCode(),
        new QueryTokenUsageNodeCode(),
        new ChartTokenUsageNodeCode(),
        // Agent / GenAI
        new MergeStringsNodeCode(),
        new DataSynthesisPrepNodeCode(),
        new GenerateMarkdownNodeCode(),
        new GenerateHtmlNodeCode(),
        new WriteEntityNodeCode(),
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
        // Analytics
        new AnalyticsNodeCode(),
        // Output
        new AgentSpeakNodeCode(),
        // Data / transform
        new HtmlToMarkdownNodeCode(),
        // Input
        new PromptInputNodeCode(),
        new PromptSelectNodeCode(),
    ];
}

/**
 * Node.js-only NodeCode instances. Uses dynamic imports to avoid pulling
 * Node.js dependencies into the Metro bundle on mobile.
 */
async function getNodeOnlyNodeCodes(): Promise<NodeCode[]> {
    const [
        { ReadFileNodeCode },
        { WriteFileNodeCode },
        { WriteToRedisNodeCode },
        { SlackBlockBuilderNodeCode },
        { SlackPostWebhookNodeCode },
        { SlackProcessSlashCommandNodeCode },
        { EmitBlocksNodeCode },
        { CliCommandNodeCode },
        { IntrospectNodeCode },
        { PampSendNodeCode },
        { PampCheckInboxNodeCode },
        { PampShareEntityNodeCode },
        { PampAwaitReplyNodeCode },
        { ListSchedulerJobsNodeCode },
        { ToggleSchedulerJobNodeCode },
        { RunSchedulerJobNodeCode },
        { A2ASendTaskNodeCode },
        { FcpProbeNodeCode },
        { FcpFetchNodeCode },
        { CxfDiscoverNodeCode },
        { CxfPullNodeCode },
        { CxfPushNodeCode },
        { Cfx3WriteNodeCode },
        { Cfx3SyncNodeCode },
        { PipelineClassifyNodeCode },
        { PipelineFactualSearchNodeCode },
        { PipelineCategoryContextNodeCode },
        { PipelineGatherContextNodeCode },
        { PipelineSelectNodesNodeCode },
        { PipelineActionLoopNodeCode },
        { PipelineSynthesizeNodeCode },
        // Cruel Summer pipeline NodeCodes
        { CSCategorizeNodeCode },
        { CSContextLoopNodeCode },
        { CSDefineSuccessNodeCode },
        { CSNodeLoopNodeCode },
        { CSBuildProcessNodeCode },
        { CSEvaluateSuccessNodeCode },
        // Hertz pipeline NodeCodes
        { HZCategorizeNodeCode },
        { HZPlanNodeCode },
        { HZExecuteNodeCode },
        { HZEvaluateNodeCode },
    ] = await Promise.all([
        import('./node-code/data/read-file-node-code.js'),
        import('./node-code/genai/write-file-node-code.js'),
        import('./node-code/genai/write-to-redis-node-code.js'),
        import('./node-code/slack/slack-block-builder-node-code.js'),
        import('./node-code/slack/slack-post-webhook-node-code.js'),
        import('./node-code/slack/slack-process-slash-command-node-code.js'),
        import('./node-code/output/emit-blocks-node-code.js'),
        import('./node-code/system/cli-command-node-code.js'),
        import('./node-code/system/introspect-node-code.js'),
        import('./node-code/pamp/pamp-send-node-code.js'),
        import('./node-code/pamp/pamp-check-inbox-node-code.js'),
        import('./node-code/pamp/pamp-share-entity-node-code.js'),
        import('./node-code/pamp/pamp-await-reply-node-code.js'),
        import('./node-code/scheduler/list-scheduler-jobs-node-code.js'),
        import('./node-code/scheduler/toggle-scheduler-job-node-code.js'),
        import('./node-code/scheduler/run-scheduler-job-node-code.js'),
        import('./node-code/a2a/a2a-send-task-node-code.js'),
        import('./node-code/context/fcp-probe-node-code.js'),
        import('./node-code/context/fcp-fetch-node-code.js'),
        import('./node-code/context/cxf-discover-node-code.js'),
        import('./node-code/context/cxf-pull-node-code.js'),
        import('./node-code/context/cxf-push-node-code.js'),
        import('./node-code/cfx3/cfx3-write-node-code.js'),
        import('./node-code/cfx3/cfx3-sync-node-code.js'),
        import('./node-code/pipeline/pipeline-classify-node-code.js'),
        import('./node-code/pipeline/pipeline-factual-search-node-code.js'),
        import('./node-code/pipeline/pipeline-category-context-node-code.js'),
        import('./node-code/pipeline/pipeline-gather-context-node-code.js'),
        import('./node-code/pipeline/pipeline-select-nodes-node-code.js'),
        import('./node-code/pipeline/pipeline-action-loop-node-code.js'),
        import('./node-code/pipeline/pipeline-synthesize-node-code.js'),
        import('./node-code/pipeline/cs-categorize-node-code.js'),
        import('./node-code/pipeline/cs-context-loop-node-code.js'),
        import('./node-code/pipeline/cs-define-success-node-code.js'),
        import('./node-code/pipeline/cs-node-loop-node-code.js'),
        import('./node-code/pipeline/cs-build-process-node-code.js'),
        import('./node-code/pipeline/cs-evaluate-success-node-code.js'),
        import('./node-code/pipeline/hz-categorize-node-code.js'),
        import('./node-code/pipeline/hz-plan-node-code.js'),
        import('./node-code/pipeline/hz-execute-node-code.js'),
        import('./node-code/pipeline/hz-evaluate-node-code.js'),
    ]);

    return [
        new ReadFileNodeCode(),
        new WriteFileNodeCode(),
        new WriteToRedisNodeCode(),
        new SlackBlockBuilderNodeCode(),
        new SlackPostWebhookNodeCode(),
        new SlackProcessSlashCommandNodeCode(),
        new EmitBlocksNodeCode(),
        new CliCommandNodeCode(),
        new IntrospectNodeCode(),
        new PampSendNodeCode(),
        new PampCheckInboxNodeCode(),
        new PampShareEntityNodeCode(),
        new PampAwaitReplyNodeCode(),
        new ListSchedulerJobsNodeCode(),
        new ToggleSchedulerJobNodeCode(),
        new RunSchedulerJobNodeCode(),
        new A2ASendTaskNodeCode(),
        new FcpProbeNodeCode(),
        new FcpFetchNodeCode(),
        new CxfDiscoverNodeCode(),
        new CxfPullNodeCode(),
        new CxfPushNodeCode(),
        new Cfx3WriteNodeCode(),
        new Cfx3SyncNodeCode(),
        // Pipeline orchestration NodeCodes (Node.js only)
        new PipelineClassifyNodeCode(),
        new PipelineFactualSearchNodeCode(),
        new PipelineCategoryContextNodeCode(),
        new PipelineGatherContextNodeCode(),
        new PipelineSelectNodesNodeCode(),
        new PipelineActionLoopNodeCode(),
        new PipelineSynthesizeNodeCode(),
        // Cruel Summer pipeline NodeCodes (Node.js only)
        new CSCategorizeNodeCode(),
        new CSContextLoopNodeCode(),
        new CSDefineSuccessNodeCode(),
        new CSNodeLoopNodeCode(),
        new CSBuildProcessNodeCode(),
        new CSEvaluateSuccessNodeCode(),
        // Hertz pipeline NodeCodes (Node.js only)
        new HZCategorizeNodeCode(),
        new HZPlanNodeCode(),
        new HZExecuteNodeCode(),
        new HZEvaluateNodeCode(),
    ];
}

/**
 * Node.js-only catalog sources. Uses dynamic imports for the same reason.
 */
async function getNodeOnlyCatalogSources(a2aAgents: unknown[]) {
    const [
        { SlackCatalogSource },
        { AgentCatalogSource },
        { SystemCatalogSource },
        { IntrospectCatalogSource },
        { AnalyticsCatalogSource },
        { PampCatalogSource },
        { A2ACatalogSource },
        { FcpCatalogSource },
        { CxfCatalogSource },
        { Cfx3CatalogSource },
        { getEnabledSources },
    ] = await Promise.all([
        import('./catalog/slack-catalog-source.js'),
        import('./catalog/agent-catalog-source.js'),
        import('./catalog/system-catalog-source.js'),
        import('./catalog/introspect-catalog-source.js'),
        import('./catalog/analytics-catalog-source.js'),
        import('./catalog/pamp-catalog-source.js'),
        import('./catalog/a2a-catalog-source.js'),
        import('./catalog/fcp-catalog-source.js'),
        import('./catalog/cxf-catalog-source.js'),
        import('./catalog/cfx3-catalog-source.js'),
        import('../cfx3/source-registry.js'),
    ]);

    const cfx3Sources = await getEnabledSources().catch(() => []);

    return [
        new SlackCatalogSource(),
        new AgentCatalogSource(),
        new SystemCatalogSource(),
        new IntrospectCatalogSource(),
        new AnalyticsCatalogSource(),
        new PampCatalogSource(),
        new A2ACatalogSource(a2aAgents as any),
        new FcpCatalogSource(),
        new CxfCatalogSource(),
        new Cfx3CatalogSource(cfx3Sources),
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

export interface BootstrapOptions {
    processSources?: ProcessSource[];
    /** 'node' (default) includes all node codes; 'mobile' excludes CLI, Slack, A2A, PAMP, Scheduler, raw file I/O */
    platform?: 'node' | 'mobile';
}

/**
 * Bootstrap the full Feral runtime:
 * 1. Creates NodeCodeFactory with all built-in node codes
 * 2. Loads user-defined catalog config from ~/.phaibel/feral-catalog.json
 * 3. Builds Catalog from built-in + user-defined sources
 * 4. Wires EventDispatcher, ProcessEngine, ProcessFactory, Runner
 */
export async function bootstrapFeral(
    processSourcesOrOpts: ProcessSource[] | BootstrapOptions = [],
): Promise<FeralRuntime> {
    const opts: BootstrapOptions = Array.isArray(processSourcesOrOpts)
        ? { processSources: processSourcesOrOpts }
        : processSourcesOrOpts;
    const processSources = opts.processSources ?? [];
    const isMobile = opts.platform === 'mobile';

    // 1. NodeCode factory — start with cross-platform codes
    const allNodeCodes = getCrossPlatformNodeCodes();
    if (!isMobile) {
        allNodeCodes.push(...await getNodeOnlyNodeCodes());
    }
    const nodeCodeFactory = new NodeCodeFactory([
        { getNodeCodes: () => allNodeCodes },
    ]);

    // 2. Load catalog config, entity types, and optionally A2A (parallel)
    let a2aAgents: unknown[] = [];
    if (!isMobile) {
        const { a2aClient } = await import('../agents/a2a-client.js');
        a2aAgents = await a2aClient.discoverAllAgents();
    }
    const [catalogConfig, entityTypes, trackedModels] = await Promise.all([
        loadFeralCatalogConfig(),
        loadEntityTypes(),
        getTrackedModels(),
    ]);

    // Skills: build the self-refreshing source and pre-warm the cache now
    // so the first getCatalogNodes() call is never empty.
    const skillCatalogSource = new SkillCatalogSource();
    await skillCatalogSource.preload();

    // 3. Build catalog from sources (skip Node-only sources on mobile)
    const catalogSources = [
        new BuiltInCatalogSource(nodeCodeFactory),
        new JsonCatalogSource(catalogConfig),
        new EntityCatalogSource(entityTypes),
        new LifePrimitivesCatalogSource(),
        new PipelineCatalogSource(),
        new OutputCatalogSource(),
        new UsageCatalogSource(trackedModels),
        skillCatalogSource,
    ];
    if (!isMobile) {
        catalogSources.push(...await getNodeOnlyCatalogSources(a2aAgents));
    }
    const catalog = new Catalog(catalogSources);

    // 4. Load process definitions from {vault}/.phaibel/processes/
    const processDir = await getProcessesDir();
    const jsonProcessSource = new JsonProcessSource(processDir);
    await jsonProcessSource.load();

    // 4b. Load vault-root process definitions from {vaultRoot}/processes/
    const vaultRoot = await findVaultRoot();
    const vaultProcessSource = new JsonProcessSource(getPlatform().paths.join(vaultRoot ?? '', 'processes'));
    await vaultProcessSource.load(); // silently handles missing dir
    const vaultProcesses: Process[] = vaultProcessSource.getProcesses();

    // 4c. Load Foundation-level process definitions from (Root)/feral/processes/
    let feralProcessSource: JsonProcessSource | null = null;
    try {
        const feralProcessDir = await getFeralProcessesDir();
        feralProcessSource = new JsonProcessSource(feralProcessDir);
        await feralProcessSource.load();
    } catch {
        // No Foundation or feral dir — skip
    }

    // 5. Wire engine
    const eventDispatcher = new EventDispatcher();
    const engine = new ProcessEngine(eventDispatcher, catalog, nodeCodeFactory);
    const pipelineProcessSrc = new PipelineProcessSource();
    const allSources: ProcessSource[] = [jsonProcessSource, vaultProcessSource, pipelineProcessSrc, ...processSources];
    if (feralProcessSource) allSources.push(feralProcessSource);
    const processFactory = new ProcessFactory(allSources);
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
