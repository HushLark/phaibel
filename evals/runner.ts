/**
 * Phaibel Evaluation Harness — Scenario Runner
 *
 * Executes eval scenarios against feralChatHeadless and scores results.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { feralChatHeadless } from '../src/commands/chat.js';
import { createEvalVault, destroyEvalVault, snapshotVault } from './vault-setup.js';
import { evaluateAssertions, computeScore } from './assertions.js';
import type {
    EvalScenario,
    EvalRunConfig,
    EvalRunResult,
    EvalSummary,
    ScenarioResult,
} from './types.js';

/**
 * Run a single scenario: set up vault, call chat, snapshot, assert, tear down.
 */
async function runScenario(
    scenario: EvalScenario,
    modelOverrides?: EvalRunConfig['modelOverrides'],
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

        // Take before snapshot
        const before = await snapshotVault();

        // Run feralChatHeadless with timeout
        const timeoutMs = (scenario.timeoutSeconds ?? 90) * 1000;
        let responseText: string;
        let processJson: Record<string, unknown> | undefined;

        try {
            responseText = await Promise.race([
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
                ).then(r => r.response),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error(`Scenario timed out after ${timeoutMs}ms`)), timeoutMs),
                ),
            ]);
        } catch (err) {
            await destroyEvalVault();
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

        // Take after snapshot
        const after = await snapshotVault();

        // Evaluate assertions
        const assertionResults = evaluateAssertions(scenario.assertions, before, after, responseText);
        const score = computeScore(scenario.assertions, assertionResults);
        const passed = assertionResults.every(r => r.passed);

        await destroyEvalVault();

        return {
            scenarioId: scenario.id,
            scenarioName: scenario.name,
            category: scenario.category,
            passed,
            score,
            assertionResults,
            responseText,
            durationMs: Date.now() - startTime,
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
    const results: ScenarioResult[] = [];

    for (const scenario of scenarios) {
        console.log(`  Running: ${scenario.id} — ${scenario.name}`);
        const result = await runScenario(scenario, config.modelOverrides);
        results.push(result);

        const icon = result.passed ? '✓' : '✗';
        const scoreStr = (result.score * 100).toFixed(0);
        const timeStr = (result.durationMs / 1000).toFixed(1);
        const errorStr = result.error ? ` [ERROR: ${result.error}]` : '';
        console.log(`  ${icon} ${scenario.id}: ${scoreStr}% (${timeStr}s)${errorStr}`);
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
    const byCategory: Record<string, { total: number; passed: number; score: number }> = {};

    for (const r of results) {
        if (!byCategory[r.category]) {
            byCategory[r.category] = { total: 0, passed: 0, score: 0 };
        }
        byCategory[r.category].total++;
        if (r.passed) byCategory[r.category].passed++;
        byCategory[r.category].score += r.score;
    }

    // Average scores per category
    for (const cat of Object.values(byCategory)) {
        cat.score = cat.total > 0 ? cat.score / cat.total : 0;
    }

    const totalScore = results.reduce((sum, r) => sum + r.score, 0);

    return {
        totalScenarios: results.length,
        passed: results.filter(r => r.passed).length,
        failed: results.filter(r => !r.passed).length,
        overallScore: results.length > 0 ? totalScore / results.length : 0,
        byCategory,
    };
}
