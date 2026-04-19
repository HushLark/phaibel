// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Public API
// ─────────────────────────────────────────────────────────────────────────────

// Errors
export {
    FeralError,
    InvalidConfigurationError,
    InvalidNodeCodeKeyError,
    InvalidNodeKeyError,
    MaximumNodeRunsError,
    MissingConfigurationValueError,
    ProcessError,
    ModelSchemaNotFoundError,
    AgentMaxIterationsError,
} from './errors.js';

// Result
export { ResultStatus, createResult } from './result/result.js';
export type { Result, ResultStatusValue } from './result/result.js';

// Context
export { DefaultContext } from './context/context.js';
export type { Context } from './context/context.js';

// Configuration
export { ConfigurationValueType, isSecret, resolveValue, resolveUnmaskedValue } from './configuration/configuration-value.js';
export type { ConfigurationValue } from './configuration/configuration-value.js';
export { ConfigurationManager } from './configuration/configuration-manager.js';
export type { ConfigurationDescription, ResultDescription } from './configuration/configuration-description.js';

// NodeCode
export { NodeCodeCategory } from './node-code/node-code.js';
export type { NodeCode, NodeCodeCategoryValue } from './node-code/node-code.js';
export { AbstractNodeCode } from './node-code/abstract-node-code.js';
export { NodeCodeFactory } from './node-code/node-code-factory.js';
export type { NodeCodeSource } from './node-code/node-code-factory.js';

// Built-in Flow Nodes
export { StartNodeCode } from './node-code/flow/start-node-code.js';
export { StopNodeCode } from './node-code/flow/stop-node-code.js';
export { NoopNodeCode } from './node-code/flow/noop-node-code.js';
export { ComparatorNodeCode } from './node-code/flow/comparator-node-code.js';
export { ContextValueResultNodeCode } from './node-code/flow/context-value-result-node-code.js';
export { ThrowExceptionNodeCode } from './node-code/flow/throw-exception-node-code.js';

// Built-in Data Nodes
export { SetContextValueNodeCode } from './node-code/data/set-context-value-node-code.js';
export { SetContextTableNodeCode } from './node-code/data/set-context-table-node-code.js';
export { CalculationNodeCode } from './node-code/data/calculation-node-code.js';
export { CounterNodeCode } from './node-code/data/counter-node-code.js';
export { HttpNodeCode } from './node-code/data/http-node-code.js';
export { JsonDecodeNodeCode } from './node-code/data/json-decode-node-code.js';
export { JsonEncodeNodeCode } from './node-code/data/json-encode-node-code.js';
export { LogNodeCode } from './node-code/data/log-node-code.js';
export { RandomValueNodeCode } from './node-code/data/random-value-node-code.js';
export { ReadFileNodeCode } from './node-code/data/read-file-node-code.js';

// Catalog
export { createCatalogNode } from './catalog/catalog-node.js';
export type { CatalogNode } from './catalog/catalog-node.js';
export { Catalog } from './catalog/catalog.js';
export type { CatalogSource } from './catalog/catalog.js';

// Process
export type { ProcessNode } from './process/node.js';
export type { Edge } from './process/edge.js';
export { EdgeCollection } from './process/edge.js';
export type { Process } from './process/process.js';
export { hydrateProcess, hydrateProcessFromString } from './process/process-json-hydrator.js';
export type { ProcessConfigJson } from './process/process-json-hydrator.js';
export { ProcessFactory } from './process/process-factory.js';
export type { ProcessSource } from './process/process-factory.js';
export { JsonProcessSource } from './process/json-process-source.js';

// Events
export type {
    ProcessStartEvent,
    ProcessEndEvent,
    ProcessNodeBeforeEvent,
    ProcessNodeAfterEvent,
    ProcessExceptionEvent,
    ProcessNodeNotifyEvent,
    ProcessEvent,
    EventType,
} from './events/events.js';
export { EventDispatcher } from './events/event-dispatcher.js';
export type { EventHandler } from './events/event-dispatcher.js';
export { createLoggerSubscriber } from './events/subscribers/logger-subscriber.js';
export { createCycleDetectionSubscriber } from './events/subscribers/cycle-detection-subscriber.js';
export { createProfilerSubscriber } from './events/subscribers/profiler-subscriber.js';

// Engine
export { ProcessEngine } from './engine/process-engine.js';

// Runner
export { Runner } from './runner/runner.js';

// Catalog Config + Sources
export { BuiltInCatalogSource } from './catalog/built-in-catalog-source.js';
export { JsonCatalogSource } from './catalog/json-catalog-source.js';
export { loadFeralCatalogConfig, saveFeralCatalogConfig } from './catalog/feral-catalog-config.js';
export type { FeralCatalogConfigJson, CatalogNodeConfigJson } from './catalog/feral-catalog-config.js';
export { SlackCatalogSource } from './catalog/slack-catalog-source.js';
export { AgentCatalogSource } from './catalog/agent-catalog-source.js';
export { EntityCatalogSource } from './catalog/entity-catalog-source.js';

// Slack NodeCodes
export { SlackBlockBuilderNodeCode } from './node-code/slack/slack-block-builder-node-code.js';
export { SlackPostWebhookNodeCode } from './node-code/slack/slack-post-webhook-node-code.js';
export { SlackProcessSlashCommandNodeCode } from './node-code/slack/slack-process-slash-command-node-code.js';

// GenAI NodeCodes
export { MergeStringsNodeCode } from './node-code/genai/merge-strings-node-code.js';
export { DataSynthesisPrepNodeCode } from './node-code/genai/data-synthesis-prep-node-code.js';
export { WriteFileNodeCode } from './node-code/genai/write-file-node-code.js';
export { GenerateMarkdownNodeCode } from './node-code/genai/generate-markdown-node-code.js';
export { GenerateHtmlNodeCode } from './node-code/genai/generate-html-node-code.js';
export { WriteEntityNodeCode } from './node-code/genai/write-entity-node-code.js';
export type { EntityPersister } from './node-code/genai/write-entity-node-code.js';
export { WriteToRedisNodeCode } from './node-code/genai/write-to-redis-node-code.js';
export type { KeyValueStore } from './node-code/genai/write-to-redis-node-code.js';
export { OpenAiNodeCode } from './node-code/genai/openai-node-code.js';
export { ModelToOutputNodeCode } from './node-code/genai/model-to-output-node-code.js';
export { HydrateModelNodeCode } from './node-code/genai/hydrate-model-node-code.js';

// Entity NodeCodes
export { ListEntitiesNodeCode } from './node-code/context/list-entities-node-code.js';
export { FindEntityNodeCode } from './node-code/context/find-entity-node-code.js';
export { CreateEntityNodeCode } from './node-code/context/create-entity-node-code.js';
export { UpdateEntityNodeCode } from './node-code/context/update-entity-node-code.js';
export { DeleteEntityNodeCode } from './node-code/context/delete-entity-node-code.js';
export { SortEntitiesNodeCode } from './node-code/context/sort-entities-node-code.js';

// Trace
export type { TraceEntry, ProcessTrace, ProcessTraceCollector } from './trace/process-trace.js';
export { DefaultProcessTraceCollector } from './trace/process-trace.js';

// Input NodeCodes
export { PromptInputNodeCode } from './node-code/input/prompt-input-node-code.js';
export { PromptSelectNodeCode } from './node-code/input/prompt-select-node-code.js';

// Slack SDK (re-export sub-module)
export * as Slack from './slack/index.js';

// Agent (re-export sub-module)
export * as Agent from './agent/index.js';

// Bootstrap
export { bootstrapFeral } from './bootstrap.js';
export type { FeralRuntime } from './bootstrap.js';
