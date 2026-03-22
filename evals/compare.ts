#!/usr/bin/env tsx
/**
 * Phaibel Evaluation Harness — Cross-Run Comparison
 *
 * Usage:
 *   tsx evals/compare.ts evals/results/run-a.json evals/results/run-b.json
 */
import { promises as fs } from 'fs';
import type { EvalRunResult } from './types.js';

async function main() {
    const files = process.argv.slice(2);
    if (files.length < 2) {
        console.error('Usage: tsx evals/compare.ts <run-a.json> <run-b.json> [run-c.json ...]');
        process.exit(1);
    }

    const runs: EvalRunResult[] = [];
    for (const f of files) {
        const raw = await fs.readFile(f, 'utf-8');
        runs.push(JSON.parse(raw));
    }

    // Collect all scenario IDs across all runs
    const allIds = new Set<string>();
    for (const run of runs) {
        for (const s of run.scenarios) {
            allIds.add(s.scenarioId);
        }
    }

    // Header
    const labels = runs.map(r => r.config.label);
    const colWidth = 20;
    const pad = (s: string, w = colWidth) => s.slice(0, w).padEnd(w);

    console.log('');
    console.log(`  ${pad('Scenario', 30)} ${labels.map(l => pad(l)).join(' ')} ${pad('Delta')}`);
    console.log(`  ${'─'.repeat(30)} ${labels.map(() => '─'.repeat(colWidth)).join(' ')} ${'─'.repeat(colWidth)}`);

    // Per-scenario rows
    for (const id of allIds) {
        const scores: (number | null)[] = runs.map(run => {
            const s = run.scenarios.find(s => s.scenarioId === id);
            return s ? s.score : null;
        });

        const cells = scores.map(s =>
            s === null ? pad('—') : pad(s === 1 ? 'PASS (100%)' : `FAIL (${(s * 100).toFixed(0)}%)`),
        );

        // Delta: last - first
        let delta = '';
        const first = scores[0];
        const last = scores[scores.length - 1];
        if (first !== null && last !== null) {
            const d = last - first;
            delta = d === 0 ? '  0' : d > 0 ? `+${(d * 100).toFixed(0)}%` : `${(d * 100).toFixed(0)}%`;
        }

        console.log(`  ${pad(id, 30)} ${cells.join(' ')} ${pad(delta)}`);
    }

    // Overall
    console.log(`  ${'─'.repeat(30)} ${labels.map(() => '─'.repeat(colWidth)).join(' ')} ${'─'.repeat(colWidth)}`);
    const overalls = runs.map(r => (r.summary.overallScore * 100).toFixed(0) + '%');
    const firstScore = runs[0].summary.overallScore;
    const lastScore = runs[runs.length - 1].summary.overallScore;
    const overallDelta = lastScore - firstScore;
    const deltaStr = overallDelta === 0 ? '  0' : overallDelta > 0 ? `+${(overallDelta * 100).toFixed(0)}%` : `${(overallDelta * 100).toFixed(0)}%`;

    console.log(`  ${pad('OVERALL', 30)} ${overalls.map(o => pad(o)).join(' ')} ${pad(deltaStr)}`);

    // Category breakdown
    console.log('\n  ── By Category ──');
    const allCats = new Set<string>();
    for (const run of runs) {
        for (const cat of Object.keys(run.summary.byCategory)) {
            allCats.add(cat);
        }
    }
    for (const cat of allCats) {
        const catScores = runs.map(r => {
            const c = r.summary.byCategory[cat];
            return c ? `${c.passed}/${c.total} (${(c.score * 100).toFixed(0)}%)` : '—';
        });
        console.log(`  ${pad(cat, 30)} ${catScores.map(s => pad(s)).join(' ')}`);
    }
    console.log('');
}

main().catch(err => {
    console.error('Compare failed:', err);
    process.exit(1);
});
