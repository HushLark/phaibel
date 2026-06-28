// ─────────────────────────────────────────────────────────────────────────────
// Pipeline NodeCode — Classify
// ─────────────────────────────────────────────────────────────────────────────
//
// Phase 0 + guard + routing:
//   1. Classify the user request (safety + intent category).
//   2. If a saved process clearly fits, run it inline and route to synthesize.
//   3. Otherwise route by category: chat / factual / category / action.
//
// Reads from context:
//   user_input          — the user's message
//   __history           — ChatHistoryEntry[]
//   __process_factory   — ProcessFactory (injected by Runner)
//   __process_engine    — ProcessEngine (injected by Runner)
//   __logger            — ChatLogger
//   __tracer            — DebugTraceCollector | undefined
//   __on_status         — (s: string) => void
//
// Writes to context:
//   __classification    — ClassificationResult
//   __request_weights   — RequestWeights
//   __all_results       — populated only if a process was reused
//   __all_reasonings    — populated only if a process was reused
//
// Result status (used as pipeline routing key):
//   "chat"      → direct synthesis (phatic exchange)
//   "reuse"     → a saved process was run; results already in context
//   "factual"   → run the phaibel.factual sub-process
//   "category"  → fast-dispatch via fetchContextByClassification
//   "action"    → full LLM-driven pipeline (gather → select → loop → synth)
//   "blocked"   → guardrail triggered; no further processing
//   "error"     → classification failed; fall through to action pipeline
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import type { ProcessEngine } from '../../engine/process-engine.js';
import type { ProcessFactory } from '../../process/process-factory.js';
import { classifyRequest, toIntentResult, BLOCKED_RESPONSE } from '../../../context/request-classifier.js';
import { inferWeights } from '../../../context/request-weights.js';
import { CATEGORY_PROCESS_KEY, CATEGORY_PROCESSES } from '../../processes/category-processes.js';
import { getModelForCapability } from '../../../llm/router.js';
import { parseJsonResponse } from '../../../utils/json-parser.js';
import { debug } from '../../../utils/debug.js';
import { scrubSecrets } from '../../../commands/chat-helpers.js';
import type { ChatHistoryEntry } from '../../../commands/chat-helpers.js';
import { hydrateProcess } from '../../process/process-json-hydrator.js';

// Keys excluded from Phase 0 process matching
const EXCLUDED_PROCESS_KEYS = new Set(['chat.generated', ...Object.values(CATEGORY_PROCESS_KEY)]);

export class PipelineClassifyNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: 'chat',     description: 'Phatic exchange — route directly to synthesis.' },
        { status: 'reuse',    description: 'A saved process was matched and run; route to synthesis.' },
        { status: 'factual',  description: 'Factual query — run the web-search process.' },
        { status: 'category', description: 'Known query category — use fast context dispatch.' },
        { status: 'action',   description: 'Action request — use full LLM-driven pipeline.' },
        { status: 'blocked',  description: 'Guardrail triggered.' },
        { status: ResultStatus.ERROR, description: 'Classification failed; fall through to action.' },
    ];

    constructor() {
        super(
            'pipeline_classify',
            'Pipeline: Classify',
            'Classifies the request, optionally reuses a saved process, and routes to the correct pipeline branch.',
            'pipeline',
        );
    }

    async process(context: Context): Promise<Result> {
        const userInput = context.getString('user_input') ?? '';
        const history = (context.get('__history') as ChatHistoryEntry[] | null) ?? [];
        const onStatus = context.get('__on_status') as ((s: string) => void) | null;
        const engine = context.get('__process_engine') as ProcessEngine | null;
        const factory = context.get('__process_factory') as ProcessFactory | null;

        const status = (s: string) => onStatus?.(s);

        // ── 1. Classify ────────────────────────────────────────────────────────
        status('Reviewing request…');
        let classification;
        try {
            const categorizeLlm = await getModelForCapability('categorize');
            classification = await classifyRequest(categorizeLlm, userInput, history);
        } catch (err) {
            debug('pipeline', `Classify error: ${err}`);
            return this.result(ResultStatus.ERROR, `Classification failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        if (classification.blocked) {
            context.set('__pipeline_response', BLOCKED_RESPONSE);
            return this.result('blocked', 'Request blocked by guardrail.');
        }

        const requestWeights = inferWeights(classification);
        context.set('__classification', classification);
        context.set('__request_weights', requestWeights);

        const intent = toIntentResult(classification);
        context.set('__intent', intent);

        // A named CF/x3 connection ("in HushLark, …") means this is a local
        // federated-context query, not a web/factual lookup or phatic chat. Coerce
        // those categories to 'query' so the context path runs and the scope applies.
        const sourceScope = context.get('__source_scope') as { id: string; name: string } | null;
        if (sourceScope && (classification.category === 'factual' || classification.category === 'chat')) {
            debug('pipeline', `Source scope ${sourceScope.id} present — coercing category ${classification.category} → query`);
            classification.category = 'query';
            context.set('__classification', classification);
        }

        debug('pipeline', `Classified: category=${classification.category} confidence=${classification.confidence}`);

        // ── 2. Chat fast path ──────────────────────────────────────────────────
        if (classification.category === 'chat') {
            return this.result('chat', 'Phatic exchange — direct synthesis.');
        }

        // ── 3. Phase 0: Process reuse check ───────────────────────────────────
        if (engine && factory) {
            // Include CATEGORY_PROCESSES in the available pool so they can be reused
            const categorySources = CATEGORY_PROCESSES;
            const allSavedProcesses = [
                ...factory.getAllProcesses(),
                ...categorySources,
            ].filter(p => !EXCLUDED_PROCESS_KEYS.has(p.key) && !p.key.startsWith('pipeline.'));

            if (allSavedProcesses.length > 0) {
                status('Checking process library…');
                const historyBlock = history.length > 0
                    ? `\nRECENT CONVERSATION:\n${history.map(h => (h.role === 'user' ? 'User: ' : 'Assistant: ') + h.content).join('\n')}\n`
                    : '';

                const processSummary = allSavedProcesses.map(p => `- ${p.key}: ${p.description}`).join('\n');

                try {
                    const categorizeLlm = await getModelForCapability('categorize');
                    const phase0Response = await categorizeLlm.chat(
                        [{
                            role: 'user' as const,
                            content: `The user said: "${userInput}"
${historyBlock}
AVAILABLE PROCESSES:
${processSummary}

You can either:
1. REUSE an existing process if it clearly fits the request
2. Choose CUSTOM to build a new process from scratch

Return JSON:
If reuse: { "action": "reuse", "process_key": "the.key", "context_overrides": {}, "reasoning": "why" }
If custom: { "action": "custom", "reasoning": "why no existing process fits" }

Return ONLY the JSON object, no markdown fences.`,
                        }],
                        {
                            systemPrompt: 'You are the process matcher for Phaibel. Determine if an existing reusable process can handle the user\'s request. Be conservative — only reuse if the process clearly fits. Better to build custom than force-fit.',
                            temperature: 0.2,
                        },
                    );

                    const matchResult = parseJsonResponse(phase0Response) as {
                        action: string;
                        process_key?: string;
                        context_overrides?: Record<string, unknown>;
                        reasoning: string;
                    };

                    if (matchResult.action === 'reuse' && matchResult.process_key) {
                        status('Running matched process…');
                        debug('pipeline', `Reusing process: ${matchResult.process_key}`);
                        context.set('__process_source', 'reuse');
                        context.set('__process_key', matchResult.process_key);

                        try {
                            // Apply context overrides before running
                            if (matchResult.context_overrides) {
                                for (const [k, v] of Object.entries(matchResult.context_overrides)) {
                                    context.set(k, v);
                                }
                            }

                            // Find and run the matched process directly
                            const matchedProcess =
                                allSavedProcesses.find(p => p.key === matchResult.process_key)
                                ?? factory.build(matchResult.process_key);

                            engine.clearCache();
                            await engine.process(matchedProcess, context);
                            engine.clearCache();

                            // Gather results from context
                            const contextResult = Object.entries(context.getAll())
                                .filter(([k]) => !k.startsWith('_') && !k.startsWith('__') && k !== 'user_input')
                                .reduce((acc, [k, v]) => {
                                    acc[k] = typeof v === 'string' && v.length > 2000 ? v.slice(0, 2000) + '…' : v;
                                    return acc;
                                }, {} as Record<string, unknown>);

                            const scrubbedResult = scrubSecrets(contextResult) as Record<string, unknown>;
                            context.set('__all_results', [scrubbedResult]);
                            context.set('__all_reasonings', [matchResult.reasoning]);

                            return this.result('reuse', `Reused process "${matchResult.process_key}".`);
                        } catch (runErr) {
                            debug('pipeline', `Reuse process failed: ${runErr} — continuing to custom pipeline`);
                            engine.clearCache();
                            // Fall through to category/action routing
                        }
                    }
                } catch (phase0Err) {
                    debug('pipeline', `Phase 0 failed: ${phase0Err} — skipping reuse check`);
                }
            }
        }

        // ── 4. Route by category ───────────────────────────────────────────────
        const cat = classification.category;

        if (cat === 'factual') {
            return this.result('factual', 'Factual query — run web search.');
        }

        if (CATEGORY_PROCESS_KEY[cat]) {
            return this.result('category', `Known category "${cat}" — fast context dispatch.`);
        }

        return this.result('action', `Action category "${cat}" — full LLM pipeline.`);
    }
}
