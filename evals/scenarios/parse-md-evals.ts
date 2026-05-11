/**
 * Markdown eval parser — converts evals/scenarios/evals.md into EvalScenario[].
 *
 * Format:
 *   ## Scenario name
 *   - input: the prompt text (required)
 *   - seed: <entityType> | <title>               (optional, can repeat)
 *   - expect entity_created: <entityType> | <titleMatch>
 *   - expect entity_updated: <entityType> | <titleMatch>
 *   - expect entity_not_created: <entityType> | <titleMatch>
 *   - expect entity_type_correct: <titleMatch> | <expectedType>
 *   - expect entity_field: <entityType> | <titleMatch> | <field> | <value>
 *   - expect entity_count: <entityType> | <number>
 *   - expect response_contains: <text>
 *   - expect context_type_created: <typeName>
 */

import type { EvalScenario, EvalAssertion, VaultSeedEntity } from '../types.js';

function slugify(name: string): string {
    return 'smoke-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function parts(line: string): string[] {
    return line.split('|').map(s => s.trim());
}

function parseAssertion(line: string): EvalAssertion | null {
    const match = line.match(/^-\s+expect\s+(\S+):\s*(.+)$/i);
    if (!match) return null;
    const [, assertionType, rest] = match;
    const p = parts(rest);

    switch (assertionType) {
        case 'entity_created':
            return { type: 'entity_created', entityType: p[0], titleMatch: p[1] ?? p[0], description: `${p[1] ?? p[0]} (${p[0]}) should be created` };
        case 'entity_updated':
            return { type: 'entity_updated', entityType: p[0], titleMatch: p[1] ?? p[0], description: `${p[1] ?? p[0]} (${p[0]}) should be updated` };
        case 'entity_not_created':
            return { type: 'entity_not_created', entityType: p[0], titleMatch: p[1] ?? p[0], description: `${p[1] ?? p[0]} (${p[0]}) should NOT be created` };
        case 'entity_type_correct':
            return { type: 'entity_type_correct', titleMatch: p[0], expectedType: p[1], description: `"${p[0]}" should be a ${p[1]}` };
        case 'entity_field':
            return { type: 'entity_field', entityType: p[0], titleMatch: p[1], field: p[2], expected: p[3], description: `${p[1]}.${p[2]} should be "${p[3]}"` };
        case 'entity_count':
            return { type: 'entity_count', entityType: p[0], expected: parseInt(p[1], 10), description: `Should have ${p[1]} ${p[0]}(s)` };
        case 'response_contains':
            return { type: 'response_contains', match: rest.trim(), description: `Response should contain "${rest.trim()}"` };
        case 'context_type_created':
            return { type: 'context_type_created', typeName: rest.trim(), description: `Context type "${rest.trim()}" should be created` };
        default:
            console.warn(`[evals.md] Unknown assertion type: ${assertionType}`);
            return null;
    }
}

function parseSeed(line: string): VaultSeedEntity | null {
    const match = line.match(/^-\s+seed:\s*(.+)$/i);
    if (!match) return null;
    const p = parts(match[1]);
    return { entityType: p[0], title: p[1] ?? p[0] };
}

export function parseMdEvals(markdown: string): EvalScenario[] {
    const scenarios: EvalScenario[] = [];
    const sections = markdown.split(/^## /m).slice(1); // drop content before first ##

    for (const section of sections) {
        const lines = section.split('\n');
        const name = lines[0].trim();
        if (!name) continue;

        let input: string | null = null;
        const assertions: EvalAssertion[] = [];
        const vaultSeed: VaultSeedEntity[] = [];

        for (const line of lines.slice(1)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;

            // input line
            const inputMatch = trimmed.match(/^-\s+input:\s*(.+)$/i);
            if (inputMatch) { input = inputMatch[1].trim(); continue; }

            // seed line
            const seed = parseSeed(trimmed);
            if (seed) { vaultSeed.push(seed); continue; }

            // assertion line
            const assertion = parseAssertion(trimmed);
            if (assertion) { assertions.push(assertion); }
        }

        if (!input) {
            console.warn(`[evals.md] Scenario "${name}" has no input line — skipping`);
            continue;
        }
        if (assertions.length === 0) {
            console.warn(`[evals.md] Scenario "${name}" has no assertions — skipping`);
            continue;
        }

        const scenario: EvalScenario = {
            id: slugify(name),
            name,
            category: 'smoke',
            userInput: input,
            assertions,
        };
        if (vaultSeed.length > 0) scenario.vaultSeed = vaultSeed;
        scenarios.push(scenario);
    }

    return scenarios;
}
