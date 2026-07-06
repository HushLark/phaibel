/**
 * Phaibel Evaluation Harness — Scenario Runner
 *
 * Executes eval scenarios against feralChatHeadless and scores results.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { feralChatHeadless, setActivePipeline } from '../src/commands/chat.js';
import { pipelineProcessSource } from '../src/feral/pipelines/pipeline-process-source.js';
import { runWithTokenTracker, type ChatTokenTotals } from '../src/llm/token-usage.js';
import { createEvalVault, destroyEvalVault, snapshotVault } from './vault-setup.js';
import { getEntityIndex } from '../src/entities/entity-index.js';
import { getEmbeddingIndex } from '../src/entities/embedding-index.js';
import { evaluateAssertions, computeScore, computeDimensionScores } from './assertions.js';
import type {
    EvalScenario,
    EvalRunConfig,
    EvalRunResult,
    EvalSummary,
    RunMetrics,
    ScenarioResult,
} from './types.js';

const ZERO_METRICS: RunMetrics = { durationMs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, llmCalls: 0 };

function metricsFrom(tokens: ChatTokenTotals, durationMs: number): RunMetrics {
    return {
        durationMs,
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens,
        costUsd: tokens.calls.reduce((sum, c) => sum + c.costUsd, 0),
        llmCalls: tokens.calls.length,
    };
}

/**
 * Run a single scenario: set up vault, call chat, snapshot, assert, tear down.
 */
async function runScenario(
    scenario: EvalScenario,
    modelOverrides?: EvalRunConfig['modelOverrides'],
    mobile = false,
): Promise<ScenarioResult> {
    const startTime = Date.now();

    try {
        // Set up vault with seed data
        const vaultDir = await createEvalVault(scenario.vaultSeed);

        // Write model overrides if provided
        if (modelOverrides && Object.keys(modelOverrides).length > 0) {
            const configDir = path.join(vaultDir, '.phaibel');
            const configPath = path.join(configDir, 'config.json');
            const existing = await fs.readFile(configPath, 'utf-8').then(JSON.parse).catch(() => ({}));
            existing.capabilityMapping = {};
            for (const [capability, { provider, model }] of Object.entries(modelOverrides)) {
                existing.capabilityMapping[capability] = { provider, model };
            }
            await fs.writeFile(configPath, JSON.stringify(existing, null, 2));
        }

        // Replicate the daemon's startup embedding sync — without this the
        // semantic dimension is silently inert (isLoaded=false) and evals
        // under-measure desktop production retrieval. Skipped when local
        // embeddings are disabled (mobile emulation without the component).
        if (process.env.PHAIBEL_DISABLE_LOCAL_EMBED !== '1') {
            try {
                const entityIndex = getEntityIndex();
                await entityIndex.build();   // singleton is lazy — sync needs a built index
                const embeddingIndex = getEmbeddingIndex();
                await embeddingIndex.load();
                const syncRes = await embeddingIndex.sync(entityIndex);
                await embeddingIndex.save();
                console.log(`  [embeddings] sync: +${syncRes.added} ~${syncRes.updated} -${syncRes.removed} (loaded=${embeddingIndex.isLoaded})`);
            } catch (err) {
                console.warn(`  ⚠ embedding sync failed (semantic scoring inactive): ${err instanceof Error ? err.message : err}`);
            }
        }

        // Take before snapshot
        const before = await snapshotVault();

        // Run feralChatHeadless with timeout.
        // APPLICATION metrics: only this call's wall-clock and LLM spend.
        // PHAIBEL_EVAL_TIMEOUT_S raises the ceiling uniformly (engine bake-offs:
        // slow engines should be measured, not killed — slowness shows in app time)
        const envFloor = Number(process.env.PHAIBEL_EVAL_TIMEOUT_S ?? 0);
        const timeoutMs = Math.max(scenario.timeoutSeconds ?? 90, envFloor) * 1000;
        let responseText: string;
        let appMetrics: RunMetrics;
        let processJson: Record<string, unknown> | undefined;

        const appStart = Date.now();
        try {
            const chatResult = await Promise.race([
                feralChatHeadless(
                    scenario.userInput,
                    () => {},                          // onStatus: no-op
                    (pj) => { processJson = pj; },     // onProcess: capture
                    async (_q: string, options?: string[]) => {
                        // If choices are offered, pick the first one
                        if (options && options.length > 0) return options[0];
                        // For free-text questions (e.g. "What time?"), give a reasonable default
                        return '12:00';
                    },
                    () => {},                           // onChatId: no-op
                    scenario.history,
                    mobile ? 'mobile' : undefined,       // platform — mirrors useChat
                    mobile ? { platform: 'mobile', screenWidth: 390, screenHeight: 844 } : undefined,
                ),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error(`Scenario timed out after ${timeoutMs}ms`)), timeoutMs),
                ),
            ]);
            responseText = chatResult.response;
            appMetrics = metricsFrom(chatResult.tokens, Date.now() - appStart);
        } catch (err) {
            await destroyEvalVault();
            return {
                scenarioId: scenario.id,
                scenarioName: scenario.name,
                category: scenario.category,
                passed: false,
                score: 0,
                accuracy: 0,
                completeness: 0,
                app: { ...ZERO_METRICS, durationMs: Date.now() - startTime },
                harness: ZERO_METRICS,
                assertionResults: [],
                responseText: '',
                durationMs: Date.now() - startTime,
                error: err instanceof Error ? err.message : String(err),
            };
        }

        // Take after snapshot
        const after = await snapshotVault();

        // Evaluate assertions inside a token tracker so LLM-judge spend is
        // attributed to the HARNESS, never to the application.
        const { result: assertionResults, tokens: harnessTokens } = await runWithTokenTracker(
            () => evaluateAssertions(scenario.assertions, before, after, responseText),
        );
        const score = computeScore(scenario.assertions, assertionResults);
        const { accuracy, completeness } = computeDimensionScores(scenario.assertions, assertionResults);
        // Pass requires BOTH dimensions perfect: nothing wrong AND nothing missing.
        const passed = accuracy === 1 && completeness === 1;

        await destroyEvalVault();

        const totalMs = Date.now() - startTime;
        // Harness time = everything that wasn't the application call
        // (vault setup/teardown, snapshots, assertion checks incl. the judge).
        const harnessMetrics = metricsFrom(harnessTokens, totalMs - appMetrics.durationMs);

        return {
            scenarioId: scenario.id,
            scenarioName: scenario.name,
            category: scenario.category,
            passed,
            score,
            accuracy,
            completeness,
            app: appMetrics,
            harness: harnessMetrics,
            assertionResults,
            responseText,
            durationMs: totalMs,
        };
    } catch (err) {
        // Ensure cleanup even on unexpected errors
        try { await destroyEvalVault(); } catch { /* ignore */ }
        return {
            scenarioId: scenario.id,
            scenarioName: scenario.name,
            category: scenario.category,
            passed: false,
            score: 0,
            assertionResults: [],
            responseText: '',
            durationMs: Date.now() - startTime,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

/**
 * Run all scenarios and produce an EvalRunResult.
 */
export async function runEval(
    scenarios: EvalScenario[],
    config: EvalRunConfig,
): Promise<EvalRunResult> {
    if (config.engine) {
        const known = pipelineProcessSource.getPipelineKeys();
        if (!known.includes(config.engine)) {
            throw new Error(`Unknown engine "${config.engine}". Registered: ${known.join(', ')}`);
        }
        setActivePipeline(config.engine);
        console.log(`  Engine: ${config.engine}`);
    }

    const results: ScenarioResult[] = [];

    const isRateLimited = (r: ScenarioResult) =>
        (r.error ?? '').includes('rate_limited') || r.responseText.includes('rate_limited');

    const mobile = config.mobile === true;
    const hardCap = async (scenario: EvalScenario): Promise<ScenarioResult> => {
        // Absolute ceiling: scenario timeout + 120s of harness allowance. A hang
        // anywhere (judge fetch, vault IO, engine promise leak) fails the scenario
        // instead of wedging the whole run.
        const envFloor = Number(process.env.PHAIBEL_EVAL_TIMEOUT_S ?? 0);
        const capMs = (Math.max(scenario.timeoutSeconds ?? 90, envFloor) + 120) * 1000;
        return Promise.race([
            runScenario(scenario, config.modelOverrides, mobile),
            new Promise<ScenarioResult>(resolve => setTimeout(() => resolve({
                scenarioId: scenario.id,
                scenarioName: scenario.name,
                category: scenario.category,
                passed: false,
                score: 0,
                accuracy: 0,
                completeness: 0,
                app: { durationMs: capMs, inputTokens: 0, outputTokens: 0, costUsd: 0, llmCalls: 0 },
                harness: { durationMs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, llmCalls: 0 },
                assertionResults: [],
                responseText: '',
                durationMs: capMs,
                error: `Hard cap: scenario exceeded ${capMs / 1000}s (harness hang guard)`,
            }), capMs)),
        ]);
    };

    for (const scenario of scenarios) {
        console.log(`  Running: ${scenario.id} — ${scenario.name}`);
        let result = await hardCap(scenario);
        // Provider rate limits poison the measurement — back off and retry the
        // scenario rather than recording a failure that isn't the engine's.
        for (let retry = 0; retry < 3 && isRateLimited(result); retry++) {
            const waitS = 30 * (retry + 1);
            console.log(`    rate-limited — waiting ${waitS}s and retrying (${retry + 1}/3)`);
            await new Promise(res => setTimeout(res, waitS * 1000));
            result = await hardCap(scenario);
        }
        results.push(result);

        // Pace scenarios so sustained runs stay under provider RPM limits
        await new Promise(res => setTimeout(res, 3000));

        const icon = result.passed ? '✓' : '✗';
        const accStr = (result.accuracy * 100).toFixed(0);
        const compStr = (result.completeness * 100).toFixed(0);
        const appStr = `${(result.app.durationMs / 1000).toFixed(1)}s $${result.app.costUsd.toFixed(4)}`;
        const harnessStr = `${(result.harness.durationMs / 1000).toFixed(1)}s $${result.harness.costUsd.toFixed(4)}`;
        const errorStr = result.error ? ` [ERROR: ${result.error}]` : '';
        console.log(`  ${icon} ${scenario.id}: accuracy ${accStr}% · completeness ${compStr}% · app ${appStr} (harness ${harnessStr})${errorStr}`);
    }

    const summary = buildSummary(results);

    return {
        runId: new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19),
        timestamp: new Date().toISOString(),
        config,
        scenarios: results,
        summary,
    };
}

function buildSummary(results: ScenarioResult[]): EvalSummary {
    const byCategory: Record<string, { total: number; passed: number; score: number; accuracy: number; completeness: number; appDurationMs: number; appCostUsd: number }> = {};

    for (const r of results) {
        if (!byCategory[r.category]) {
            byCategory[r.category] = { total: 0, passed: 0, score: 0, accuracy: 0, completeness: 0, appDurationMs: 0, appCostUsd: 0 };
        }
        byCategory[r.category].total++;
        if (r.passed) byCategory[r.category].passed++;
        byCategory[r.category].score += r.score;
        byCategory[r.category].accuracy += r.accuracy;
        byCategory[r.category].completeness += r.completeness;
        byCategory[r.category].appDurationMs += r.app.durationMs;
        byCategory[r.category].appCostUsd += r.app.costUsd;
    }

    // Average scores per category
    for (const cat of Object.values(byCategory)) {
        cat.score = cat.total > 0 ? cat.score / cat.total : 0;
        cat.accuracy = cat.total > 0 ? cat.accuracy / cat.total : 0;
        cat.completeness = cat.total > 0 ? cat.completeness / cat.total : 0;
    }

    const totalScore = results.reduce((sum, r) => sum + r.score, 0);
    const totalAccuracy = results.reduce((sum, r) => sum + r.accuracy, 0);
    const totalCompleteness = results.reduce((sum, r) => sum + r.completeness, 0);

    const sumMetrics = (pick: (r: ScenarioResult) => RunMetrics): RunMetrics => results.reduce(
        (acc, r) => {
            const m = pick(r);
            return {
                durationMs: acc.durationMs + m.durationMs,
                inputTokens: acc.inputTokens + m.inputTokens,
                outputTokens: acc.outputTokens + m.outputTokens,
                costUsd: acc.costUsd + m.costUsd,
                llmCalls: acc.llmCalls + m.llmCalls,
            };
        },
        { ...ZERO_METRICS },
    );

    return {
        totalScenarios: results.length,
        passed: results.filter(r => r.passed).length,
        failed: results.filter(r => !r.passed).length,
        overallScore: results.length > 0 ? totalScore / results.length : 0,
        overallAccuracy: results.length > 0 ? totalAccuracy / results.length : 0,
        overallCompleteness: results.length > 0 ? totalCompleteness / results.length : 0,
        appTotals: sumMetrics(r => r.app),
        harnessTotals: sumMetrics(r => r.harness),
        byCategory,
    };
}
