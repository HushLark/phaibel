#!/usr/bin/env tsx
/**
 * Phaibel Evaluation Harness — CLI Entry Point
 *
 * Usage:
 *   tsx evals/run-eval.ts --label "baseline"
 *   tsx evals/run-eval.ts --label "prompt-v2" --filter event-not-task,task-not-event
 *   tsx evals/run-eval.ts --label "sonnet-test" --model-override reason=anthropic:claude-sonnet-4-6
 */
import { promises as fs } from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { ALL_SCENARIOS } from './scenarios/index.js';
import { runEval } from './runner.js';
import type { EvalRunConfig, EvalScenario } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface ParsedArgs {
    label: string;
    filter?: string[];
    scenariosFile?: string;
    modelOverrides?: Record<string, { provider: string; model: string }>;
}

function parseArgs(argv: string[]): ParsedArgs {
    let label = 'unnamed';
    let filter: string[] | undefined;
    let scenariosFile: string | undefined;
    const modelOverrides: Record<string, { provider: string; model: string }> = {};

    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === '--label' && argv[i + 1]) {
            label = argv[++i];
        } else if (argv[i] === '--filter' && argv[i + 1]) {
            filter = argv[++i].split(',').map(s => s.trim());
        } else if (argv[i] === '--scenarios-file' && argv[i + 1]) {
            scenariosFile = argv[++i];
        } else if (argv[i] === '--model-override' && argv[i + 1]) {
            // Format: capability=provider:model (e.g., reason=anthropic:claude-sonnet-4-6)
            const parts = argv[++i].split('=');
            if (parts.length === 2) {
                const [capability, providerModel] = parts;
                const [provider, ...modelParts] = providerModel.split(':');
                modelOverrides[capability] = { provider, model: modelParts.join(':') };
            }
        }
    }

    return { label, filter, scenariosFile, modelOverrides: Object.keys(modelOverrides).length > 0 ? modelOverrides : undefined };
}

async function main() {
    const args = parseArgs(process.argv);

    // Get git commit
    let gitCommit: string | undefined;
    try {
        gitCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    } catch { /* not in a git repo */ }

    // Load scenarios — core + optional persona scenarios from file
    let scenarios: EvalScenario[] = [...ALL_SCENARIOS];
    if (args.scenariosFile) {
        try {
            const absPath = path.resolve(args.scenariosFile);
            const mod = await import(absPath);
            const personaScenarios: EvalScenario[] = mod.personaScenarios ?? mod.default ?? [];
            console.log(`  Persona scenarios: ${personaScenarios.length} loaded from ${args.scenariosFile}`);
            scenarios = [...scenarios, ...personaScenarios];
        } catch (err) {
            console.error(`Failed to load scenarios from ${args.scenariosFile}:`, err);
            process.exit(1);
        }
    }

    // Filter scenarios
    if (args.filter) {
        scenarios = scenarios.filter(s => args.filter!.includes(s.id));
        if (scenarios.length === 0) {
            console.error(`No scenarios match filter: ${args.filter.join(', ')}`);
            console.error(`Available: ${scenarios.map(s => s.id).join(', ')}`);
            process.exit(1);
        }
    }

    const config: EvalRunConfig = {
        label: args.label,
        gitCommit,
        scenarioFilter: args.filter,
        modelOverrides: args.modelOverrides,
    };

    console.log(`\n  Phaibel Eval — "${args.label}"`);
    console.log(`  Commit: ${gitCommit ?? 'unknown'}`);
    console.log(`  Scenarios: ${scenarios.length}`);
    if (args.modelOverrides) {
        console.log(`  Model overrides: ${JSON.stringify(args.modelOverrides)}`);
    }
    console.log('');

    const result = await runEval(scenarios, config);

    // Write results
    const resultsDir = path.join(__dirname, 'results');
    await fs.mkdir(resultsDir, { recursive: true });
    const resultFile = path.join(resultsDir, `${result.runId}.json`);
    await fs.writeFile(resultFile, JSON.stringify(result, null, 2));

    // Print summary
    console.log('\n  ── Summary ──');
    console.log(`  Score:  ${(result.summary.overallScore * 100).toFixed(0)}%`);
    console.log(`  Passed: ${result.summary.passed}/${result.summary.totalScenarios}`);
    console.log('');
    for (const [cat, stats] of Object.entries(result.summary.byCategory)) {
        console.log(`  ${cat}: ${stats.passed}/${stats.total} (${(stats.score * 100).toFixed(0)}%)`);
    }
    console.log(`\n  Results: ${resultFile}\n`);
}

main().catch(err => {
    console.error('Eval failed:', err);
    process.exit(1);
});
