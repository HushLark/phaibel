// ─────────────────────────────────────────────────────────────────────────────
// Feral Autonomous Chat — Pipeline Host
// ─────────────────────────────────────────────────────────────────────────────
//
// feralChatHeadless is a thin host:
//   1. Bootstrap the Feral runtime + load entity types + vault context.
//   2. Build per-request context (entity index, LLM models, tracing, callbacks).
//   3. Run the active named pipeline process (default: pipeline.standard).
//   4. Return the synthesised response from __pipeline_response.
//
// All orchestration logic lives in pipeline NodeCodes under
// src/feral/node-code/pipeline/.  To add a new pipeline variant, register a
// new process in PipelineProcessSource and change the pipeline key here.
// ─────────────────────────────────────────────────────────────────────────────

import chalk from 'chalk';
import inquirer from 'inquirer';
import { bootstrapFeral, type BootstrapOptions } from '../feral/bootstrap.js';
import { CATEGORY_PROCESSES } from '../feral/processes/category-processes.js';
import { getCapabilityModel } from '../config.js';
import { debug } from '../utils/debug.js';
import { ChatLogger, generateChatId } from '../utils/chat-logger.js';
import { writeExecutionLog } from '../utils/execution-logger.js';
import { loadEntityTypes } from '../entities/entity-type-config.js';
import { getUserName } from '../state/manager.js';
import { getVaultContext } from '../context/reader.js';
import { getEntityIndex } from '../entities/entity-index.js';
import { runWithTokenTracker, type ChatTokenTotals } from '../llm/token-usage.js';
import { DebugTraceCollector, type ProcessNodeRecord } from '../utils/debug-trace.js';
import type { ProcessNodeBeforeEvent, ProcessNodeAfterEvent } from '../feral/events/events.js';
import {
    InMemoryProcessSource,
    scrubSecrets,
    type ChatHistoryEntry,
    type ClientHints,
} from './chat-helpers.js';
import { STANDARD_PIPELINE_KEY } from '../feral/pipelines/standard-pipeline.js';
import { pipelineProcessSource } from '../feral/pipelines/pipeline-process-source.js';
import { resolveScopeFromInput } from '../cfx3/source-registry.js';

// Re-export public types so callers (web-server, a2a-server) keep working.
export type { ChatHistoryEntry, ClientHints };

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatResult {
    response: string;
    tokens: ChatTokenTotals;
}

/** Key of the active pipeline process.  Override to A/B-test alternatives. */
export let activePipelineKey = STANDARD_PIPELINE_KEY;

export function setActivePipeline(key: string): void {
    // Persisted configs may reference retired engines (see docs/ENGINE-GRAVEYARD.md);
    // an unknown key would fail every chat turn, so fall back to Standard.
    if (!pipelineProcessSource.getPipelineKeys().includes(key)) {
        debug('chat', `Unknown pipeline "${key}" — falling back to ${STANDARD_PIPELINE_KEY}`);
        key = STANDARD_PIPELINE_KEY;
    }
    activePipelineKey = key;
    debug('chat', `Active pipeline set to: ${key}`);
}

export async function feralChatHeadless(
    userInput: string,
    onStatus?: (status: string) => void,
    onProcess?: (processJson: Record<string, unknown>) => void,
    onQuestion?: (question: string, options?: string[]) => Promise<string>,
    onChatId?: (chatId: string) => void,
    history?: ChatHistoryEntry[],
    platform?: BootstrapOptions['platform'],
    clientHints?: ClientHints,
    onDebugTrace?: (chatId: string, markdown: string) => void | Promise<void>,
): Promise<ChatResult> {
    const status = (s: string) => onStatus?.(s);
    const chatId = generateChatId();
    const logger = new ChatLogger(chatId);
    const tracer = onDebugTrace ? new DebugTraceCollector(chatId, userInput) : undefined;

    import('../analytics/analytics-service.js')
        .then(({ getAnalyticsService }) => getAnalyticsService().recordChat())
        .catch(() => {});

    onChatId?.(chatId);
    status('Thinking…');

    try {
        const { result: response, tokens } = await runWithTokenTracker(() =>
            _feralChatHeadlessInner(
                userInput, status, onProcess, onQuestion,
                logger, chatId, history ?? [], platform, clientHints, tracer,
            )
        );
        const totalCostUsd = tokens.calls.reduce((s, c) => s + c.costUsd, 0);
        await logger.log('summary', {
            inputTokens: tokens.inputTokens,
            outputTokens: tokens.outputTokens,
            totalTokens: tokens.totalTokens,
            estimatedCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
            calls: tokens.calls,
        });

        if (tracer && onDebugTrace) {
            for (const call of tokens.calls) {
                const msgs = call.prompt?.messages ?? [];
                tracer.addLlmCall({
                    step: 'pipeline',
                    model: call.model,
                    inputTokens: call.inputTokens,
                    outputTokens: call.outputTokens,
                    systemExcerpt: (call.prompt?.system ?? '').slice(0, 500),
                    userExcerpt: (msgs.find(m => m.role === 'user')?.content ?? '').slice(0, 500),
                    responseExcerpt: (call.response ?? '').slice(0, 1000),
                });
            }
            tracer.setOutcome(response, { input: tokens.inputTokens, output: tokens.outputTokens });
            const markdown = tracer.formatMarkdown();
            Promise.resolve(onDebugTrace(chatId, markdown)).catch(() => {});
        }

        return { response, tokens };
    } catch (error) {
        await logger.log('error', {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        });
        throw error;
    } finally {
        logger.close();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// INNER IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

async function _feralChatHeadlessInner(
    userInput: string,
    status: (s: string) => void,
    onProcess: ((processJson: Record<string, unknown>) => void) | undefined,
    onQuestion: ((question: string, options?: string[]) => Promise<string>) | undefined,
    logger: ChatLogger,
    chatId: string,
    history: ChatHistoryEntry[],
    platform?: BootstrapOptions['platform'],
    clientHints?: ClientHints,
    tracer?: DebugTraceCollector,
): Promise<string> {

    // ── Bootstrap ──────────────────────────────────────────────────────────────
    const inMemorySource = new InMemoryProcessSource();
    for (const p of CATEGORY_PROCESSES) inMemorySource.add(p);

    const [runtime, entityTypes, userName] = await Promise.all([
        bootstrapFeral({ processSources: [inMemorySource], platform }),
        loadEntityTypes().catch(() => []),
        getUserName().catch(() => 'friend'),
    ]);

    // ── Event tracing ──────────────────────────────────────────────────────────
    const _nodeStartTimes = new Map<string, number>();
    const _nodeRecords: ProcessNodeRecord[] = [];
    if (tracer) {
        runtime.eventDispatcher.on<ProcessNodeBeforeEvent>('process.node.before', (e) => {
            _nodeStartTimes.set(e.node.key, Date.now());
        });
        runtime.eventDispatcher.on<ProcessNodeAfterEvent>('process.node.after', (e) => {
            const start = _nodeStartTimes.get(e.node.key) ?? Date.now();
            _nodeRecords.push({
                nodeKey: e.node.key,
                durationMs: Date.now() - start,
                status: e.result.status,
                message: typeof (e.result as { message?: string }).message === 'string'
                    ? (e.result as { message: string }).message
                    : '',
            });
        });
    }

    await logger.log('start', { chatId, userInput });

    // ── Pre-request setup ──────────────────────────────────────────────────────
    const vaultContext = scrubSecrets(await getVaultContext().catch(() => '')) as string;

    const entityIndex = getEntityIndex();
    if (!entityIndex.isBuilt) await entityIndex.build();

    if (tracer) {
        tracer.setContextSummary(
            `vault context: ${vaultContext.length} chars | entity types: ${entityTypes.length} | entity index built: ${entityIndex.isBuilt}`,
        );
    }

    const reasonMapping = await getCapabilityModel('reason');
    const reasonModelName = reasonMapping?.model ?? 'gpt-4o';

    // ── CF/x3 connection scope ───────────────────────────────────────────────────
    // If the user named a connected CF/x3 source ("in Acme, what's the latest"),
    // scope context retrieval to it and attribute the answer to it.
    const sourceScope = await resolveScopeFromInput(userInput).catch(() => undefined);
    if (sourceScope) debug('chat', `Scoped to CF/x3 connection: ${sourceScope.name} (${sourceScope.id})`);

    // ── Run the active pipeline process ────────────────────────────────────────
    const pipelineKey = activePipelineKey;
    debug('chat', `Running pipeline: ${pipelineKey}`);

    const ctx = await runtime.runner.run(pipelineKey, {
        user_input:          userInput,
        __source_scope:      sourceScope ?? null,
        __history:           history,
        __vault_context:     vaultContext,
        __entity_types:      entityTypes,
        __entity_index:      entityIndex,
        __logger:            logger,
        __tracer:            tracer,
        __chat_id:           chatId,
        __on_status:         status,
        __on_process:        onProcess,
        __on_question:       onQuestion,
        __client_hints:      clientHints,
        __bootstrap_runtime: runtime,
        __reason_model_name: reasonModelName,
        __user_name:         userName,
    });

    // ── Collect results for logging + tracing ──────────────────────────────────
    if (tracer) {
        tracer.setProcessNodes([..._nodeRecords]);
        const allResults = ctx.get('__all_results') as Record<string, unknown>[] | null;
        const contextSnapshot = Object.fromEntries(
            Object.entries(ctx.getAll())
                .filter(([k]) => !k.startsWith('__') && !k.startsWith('_') && k !== 'user_input'),
        );
        tracer.setContextValues(scrubSecrets(contextSnapshot) as Record<string, unknown>);
        if (allResults?.length) {
            const classification = ctx.get('__classification') as { category?: string; summary?: string; confidence?: number } | null;
            const weights = ctx.get('__request_weights') as Record<string, unknown> | null;
            if (classification) {
                tracer.setClassification({
                    category:   classification.category ?? '',
                    confidence: classification.confidence ?? 0,
                    summary:    classification.summary ?? '',
                    timeframes: [],
                    subjects:   [],
                    attributes: [],
                    weights:    weights ?? {},
                });
            }
            const processKey = ctx.getString('__process_key') ?? pipelineKey;
            const processSource = ctx.getString('__process_source') ?? 'pipeline';
            tracer.setProcess(processSource, processKey);
        }
    }

    const response = (ctx.getString('__pipeline_response') ?? '').trim();
    await logger.log('response', { response });

    // ── Execution log ──────────────────────────────────────────────────────────
    const allResults = (ctx.get('__all_results') as Record<string, unknown>[] | null) ?? [];
    const allReasonings = (ctx.get('__all_reasonings') as string[] | null) ?? [];
    const processSource = ctx.getString('__process_source') ?? 'pipeline';
    const processKey = ctx.getString('__process_key') ?? pipelineKey;

    writeExecutionLog({
        timestamp:       new Date().toISOString(),
        chat_id:         chatId,
        user_input:      userInput,
        process_source:  (processSource as 'reuse' | 'custom' | 'skill' | 'category') || 'custom',
        process_key:     processKey,
        process_json:    { key: processKey, pipeline: pipelineKey },
        context_result:  allResults.length > 0 ? allResults[allResults.length - 1] : {},
        success:         !allResults.some(r => r._error),
        outcome_summary: response.slice(0, 500),
        iterations:      allReasonings.length,
    }).catch(err => debug('chat', `Execution log write failed: ${err}`));

    return response;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI FOLLOW-UP
// ─────────────────────────────────────────────────────────────────────────────

export async function askFollowUp(question: string): Promise<string> {
    const { answer } = await inquirer.prompt([{
        type: 'input',
        name: 'answer',
        message: question,
    }]);
    return answer as string;
}

// chalk re-export kept for CLI consumers
export { chalk };
