#!/usr/bin/env tsx
/**
 * Phaibel Evaluation Loop — Automated Eval → Analyze → Commit
 *
 * Run this after making changes to prompts, models, or processes.
 * It will:
 *   1. Run the full eval suite against the current code
 *   2. Load the previous best result (if any)
 *   3. Compare scores
 *   4. If better (or first run): auto-commit with detailed analysis
 *   5. If worse: report what regressed and skip commit
 *
 * Usage:
 *   npm run eval:loop                              # Run all scenarios
 *   npm run eval:loop -- --label "tweak prompts"   # Custom label
 *   npm run eval:loop -- --filter event-not-task   # Subset of scenarios
 *   npm run eval:loop -- --threshold 0             # Commit even if same score
 *   npm run eval:loop -- --max-loops 3             # Run up to 3 improvement loops
 */
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { ALL_SCENARIOS } from './scenarios/index.js';
import { runEval } from './runner.js';
import type { EvalRunConfig, EvalRunResult, ScenarioResult } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, 'results');
const BASELINE_FILE = path.join(RESULTS_DIR, '_baseline.json');

// ─────────────────────────────────────────────────────────────────────────────
// CLI ARGS
// ─────────────────────────────────────────────────────────────────────────────

interface LoopArgs {
    label: string;
    filter?: string[];
    threshold: number;      // minimum score improvement to auto-commit (default 0.01)
    maxLoops: number;       // max iterations (default 1)
    modelOverrides?: Record<string, { provider: string; model: string }>;
}

function parseArgs(argv: string[]): LoopArgs {
    let label = '';
    let filter: string[] | undefined;
    let threshold = 0.01;
    let maxLoops = 1;
    const modelOverrides: Record<string, { provider: string; model: string }> = {};

    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === '--label' && argv[i + 1]) {
            label = argv[++i];
        } else if (argv[i] === '--filter' && argv[i + 1]) {
            filter = argv[++i].split(',').map(s => s.trim());
        } else if (argv[i] === '--threshold' && argv[i + 1]) {
            threshold = parseFloat(argv[++i]);
        } else if (argv[i] === '--max-loops' && argv[i + 1]) {
            maxLoops = parseInt(argv[++i], 10);
        } else if (argv[i] === '--model-override' && argv[i + 1]) {
            const parts = argv[++i].split('=');
            if (parts.length === 2) {
                const [capability, providerModel] = parts;
                const [provider, ...modelParts] = providerModel.split(':');
                modelOverrides[capability] = { provider, model: modelParts.join(':') };
            }
        }
    }

    return {
        label,
        filter,
        threshold,
        maxLoops,
        modelOverrides: Object.keys(modelOverrides).length > 0 ? modelOverrides : undefined,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function gitCommitHash(): string {
    try {
        return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    } catch {
        return 'unknown';
    }
}

function hasUncommittedChanges(): boolean {
    try {
        const status = execSync('git status --porcelain', { encoding: 'utf-8' }).trim();
        return status.length > 0;
    } catch {
        return false;
    }
}

function getChangedFiles(): string[] {
    try {
        const output = execSync('git diff --name-only && git diff --cached --name-only', { encoding: 'utf-8' }).trim();
        return output ? [...new Set(output.split('\n'))] : [];
    } catch {
        return [];
    }
}

async function loadBaseline(): Promise<EvalRunResult | null> {
    try {
        const raw = await fs.readFile(BASELINE_FILE, 'utf-8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

async function saveBaseline(result: EvalRunResult): Promise<void> {
    await fs.mkdir(RESULTS_DIR, { recursive: true });
    await fs.writeFile(BASELINE_FILE, JSON.stringify(result, null, 2));
}

async function saveResult(result: EvalRunResult): Promise<string> {
    await fs.mkdir(RESULTS_DIR, { recursive: true });
    const resultFile = path.join(RESULTS_DIR, `${result.runId}.json`);
    await fs.writeFile(resultFile, JSON.stringify(result, null, 2));
    return resultFile;
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────

interface Analysis {
    improved: boolean;
    scoreDelta: number;
    improvements: string[];
    regressions: string[];
    unchanged: string[];
    summary: string;
}

function analyze(current: EvalRunResult, baseline: EvalRunResult | null): Analysis {
    if (!baseline) {
        return {
            improved: true,
            scoreDelta: current.summary.overallScore,
            improvements: [],
            regressions: [],
            unchanged: [],
            summary: `First eval run: ${(current.summary.overallScore * 100).toFixed(0)}% (${current.summary.passed}/${current.summary.totalScenarios} passed)`,
        };
    }

    const scoreDelta = current.summary.overallScore - baseline.summary.overallScore;
    const improvements: string[] = [];
    const regressions: string[] = [];
    const unchanged: string[] = [];

    // Compare per-scenario
    for (const curr of current.scenarios) {
        const prev = baseline.scenarios.find(s => s.scenarioId === curr.scenarioId);
        if (!prev) {
            if (curr.passed) improvements.push(`+ NEW ${curr.scenarioId}: PASS`);
            else unchanged.push(`  NEW ${curr.scenarioId}: FAIL`);
            continue;
        }
        if (curr.score > prev.score) {
            improvements.push(`+ ${curr.scenarioId}: ${fmtScore(prev.score)} → ${fmtScore(curr.score)}`);
        } else if (curr.score < prev.score) {
            regressions.push(`- ${curr.scenarioId}: ${fmtScore(prev.score)} → ${fmtScore(curr.score)}`);
        } else {
            unchanged.push(`  ${curr.scenarioId}: ${fmtScore(curr.score)} (unchanged)`);
        }
    }

    const prevScore = fmtScore(baseline.summary.overallScore);
    const currScore = fmtScore(current.summary.overallScore);
    const deltaStr = scoreDelta >= 0 ? `+${fmtScore(scoreDelta)}` : fmtScore(scoreDelta);

    let summary = `Score: ${prevScore} → ${currScore} (${deltaStr})`;
    summary += `\nPassed: ${current.summary.passed}/${current.summary.totalScenarios}`;
    if (improvements.length > 0) summary += `\n\nImprovements:\n${improvements.join('\n')}`;
    if (regressions.length > 0) summary += `\n\nRegressions:\n${regressions.join('\n')}`;

    return {
        improved: scoreDelta > 0 || (scoreDelta === 0 && improvements.length > 0),
        scoreDelta,
        improvements,
        regressions,
        unchanged,
        summary,
    };
}

function fmtScore(s: number): string {
    return `${(s * 100).toFixed(0)}%`;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMIT
// ─────────────────────────────────────────────────────────────────────────────

async function autoCommit(label: string, analysis: Analysis, result: EvalRunResult, resultFile: string): Promise<void> {
    const changedFiles = getChangedFiles();
    const score = fmtScore(result.summary.overallScore);

    // Build commit message
    let msg = `eval: ${label || 'improvement'} — ${score} (${result.summary.passed}/${result.summary.totalScenarios})`;
    msg += `\n\n${analysis.summary}`;
    msg += `\n\nChanged files: ${changedFiles.join(', ')}`;

    // Per-category breakdown
    msg += '\n\nBy category:';
    for (const [cat, stats] of Object.entries(result.summary.byCategory)) {
        msg += `\n  ${cat}: ${stats.passed}/${stats.total} (${fmtScore(stats.score)})`;
    }

    // Failed scenarios detail
    const failed = result.scenarios.filter(s => !s.passed);
    if (failed.length > 0) {
        msg += '\n\nFailing scenarios:';
        for (const s of failed) {
            msg += `\n  ${s.scenarioId}: ${s.assertionResults.filter(a => !a.passed).map(a => a.message).join('; ')}`;
        }
    }

    // Stage all changed source files + the eval result
    try {
        // Stage source changes
        if (changedFiles.length > 0) {
            execSync(`git add ${changedFiles.map(f => `"${f}"`).join(' ')}`, { encoding: 'utf-8' });
        }
        // Also stage the result file and baseline
        execSync(`git add "${resultFile}" "${BASELINE_FILE}"`, { encoding: 'utf-8' });

        // Write commit message to a temp file to avoid shell escaping issues
        const tmpMsg = path.join(os.tmpdir(), `phaibel-eval-commit-${Date.now()}.txt`);
        await fs.writeFile(tmpMsg, msg);
        try {
            execSync(`git commit -F "${tmpMsg}"`, { encoding: 'utf-8' });
            console.log('\n  ✓ Changes committed.');
        } finally {
            await fs.unlink(tmpMsg).catch(() => {});
        }
    } catch (err) {
        console.error('\n  ✗ Git commit failed:', err instanceof Error ? err.message : err);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN LOOP
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
    const args = parseArgs(process.argv);

    // Filter scenarios
    let scenarios = ALL_SCENARIOS;
    if (args.filter) {
        scenarios = scenarios.filter(s => args.filter!.includes(s.id));
        if (scenarios.length === 0) {
            console.error(`No scenarios match filter: ${args.filter.join(', ')}`);
            process.exit(1);
        }
    }

    const baseline = await loadBaseline();

    for (let loop = 1; loop <= args.maxLoops; loop++) {
        const loopLabel = args.label || (baseline ? 'iteration' : 'baseline');

        console.log(`\n${'═'.repeat(60)}`);
        console.log(`  Eval Loop ${loop}/${args.maxLoops} — "${loopLabel}"`);
        console.log(`  Commit: ${gitCommitHash()}`);
        console.log(`  Scenarios: ${scenarios.length}`);
        console.log(`  Baseline: ${baseline ? `${fmtScore(baseline.summary.overallScore)} (${baseline.config.label})` : 'none (first run)'}`);
        console.log(`${'═'.repeat(60)}\n`);

        // Run eval
        const config: EvalRunConfig = {
            label: `${loopLabel}${args.maxLoops > 1 ? ` [${loop}/${args.maxLoops}]` : ''}`,
            gitCommit: gitCommitHash(),
            scenarioFilter: args.filter,
            modelOverrides: args.modelOverrides,
        };

        const result = await runEval(scenarios, config);
        const resultFile = await saveResult(result);

        // Analyze
        const analysis = analyze(result, baseline);

        console.log(`\n${'─'.repeat(60)}`);
        console.log('  Analysis:');
        console.log(`  ${analysis.summary.split('\n').join('\n  ')}`);
        console.log(`${'─'.repeat(60)}`);

        if (!baseline) {
            // First run — save as baseline and commit
            await saveBaseline(result);
            console.log('\n  First run saved as baseline.');

            if (hasUncommittedChanges()) {
                await autoCommit(loopLabel, analysis, result, resultFile);
            } else {
                console.log('  No uncommitted changes to commit.');
            }
            break;
        }

        if (analysis.scoreDelta >= args.threshold && analysis.regressions.length === 0) {
            // Strictly better — commit
            console.log(`\n  ✓ Score improved by ${fmtScore(analysis.scoreDelta)} with no regressions.`);
            await saveBaseline(result);

            if (hasUncommittedChanges()) {
                await autoCommit(loopLabel, analysis, result, resultFile);
            } else {
                console.log('  No uncommitted changes to commit (eval-only run).');
            }
            break;
        } else if (analysis.scoreDelta >= args.threshold && analysis.regressions.length > 0) {
            // Better overall but has regressions — commit with warning
            console.log(`\n  ~ Score improved by ${fmtScore(analysis.scoreDelta)} but has ${analysis.regressions.length} regression(s).`);
            console.log('  Committing since net improvement is positive.');
            await saveBaseline(result);

            if (hasUncommittedChanges()) {
                await autoCommit(loopLabel, analysis, result, resultFile);
            }
            break;
        } else {
            // Worse or unchanged — don't commit
            console.log(`\n  ✗ No improvement (delta: ${fmtScore(analysis.scoreDelta)}).`);
            if (analysis.regressions.length > 0) {
                console.log('  Regressions:');
                for (const r of analysis.regressions) {
                    console.log(`    ${r}`);
                }
            }
            console.log('  Skipping commit. Review the results and tweak further.');
            console.log(`  Results saved: ${resultFile}`);

            if (loop < args.maxLoops) {
                console.log(`\n  Continuing to loop ${loop + 1}...`);
            }
        }
    }
}

main().catch(err => {
    console.error('Eval loop failed:', err);
    process.exit(1);
});
