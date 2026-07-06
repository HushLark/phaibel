#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Pipeline smoke tests — runs a curated set of prompts through each pipeline
// and prints timing, token usage, and accuracy.
//
// Usage:
//   node tests/headless/pipeline-test.mjs                  # all pipelines
//   node tests/headless/pipeline-test.mjs standard         # standard only
//   node tests/headless/pipeline-test.mjs take-on-me       # take-on-me only
// ─────────────────────────────────────────────────────────────────────────────

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.PHAIBEL_VAULT = path.resolve(__dirname, 'vault');

const { feralChatHeadless, setActivePipeline } = await import('../../dist/commands/chat.js');

// ── Single-turn scenarios ─────────────────────────────────────────────────────
const PROMPTS = [
    { label: 'greeting',       text: 'Hey, how are you?',                      expect: 'chat fast-path' },
    { label: 'list tasks',     text: 'What tasks do I have open?',             expect: 'query — should list tasks from vault' },
    { label: 'find person',    text: 'Tell me about Alice Chen',                expect: 'query — should find alice-chen entity' },
    { label: 'create task',    text: 'Create a task to review the Q3 budget',  expect: 'action — creates entity' },
    { label: 'context action', text: 'Complete the book dentist task',          expect: 'action — marks existing task complete' },
];

// ── Multi-turn sessions (history carries across turns) ────────────────────────
const SESSIONS = [
    {
        label: 'quick task + followups',
        expect: 'multi-turn — quick create, then refine with person name and due date',
        turns: [
            {
                label: 'quick add',
                text: 'Add a task to follow up with Mike about the proposal',
                expect: 'creates task — minimal detail, no last name or due date',
            },
            {
                label: 'add last name',
                text: "Oh, his last name is Torres",
                expect: 'updates task or person with last name Torres',
            },
            {
                label: 'set due date',
                text: 'Set it due this Friday',
                expect: 'adds due date to the task',
            },
        ],
    },
    {
        label: 'quick event + followups',
        expect: 'multi-turn — quick schedule, then clarify attendee and add note',
        turns: [
            {
                label: 'quick add',
                text: 'Schedule lunch with Sarah next Tuesday at noon',
                expect: 'creates calendar event — no last name yet',
            },
            {
                label: 'add last name',
                text: "Her last name is Kim",
                expect: 'updates event or person with last name Kim',
            },
            {
                label: 'add note',
                text: "Add a note that we're discussing the Q4 roadmap",
                expect: 'adds note/description to the event',
            },
        ],
    },
];

const PIPELINES = process.argv[2]
    ? [process.argv[2]]
    : ['standard', 'take-on-me'];

const PASS  = '\x1b[32m✓\x1b[0m';
const FAIL  = '\x1b[31m✗\x1b[0m';
const DIM   = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD  = '\x1b[1m';
const CYAN  = '\x1b[36m';
const YELLOW = '\x1b[33m';
const BLUE  = '\x1b[34m';
const MAGENTA = '\x1b[35m';

function bar(char = '─', len = 70) { return char.repeat(len); }
function fmt(n) { return n.toLocaleString(); }

// ── Detect retry depth from status chain ─────────────────────────────────────
// "(step 2)" / "(step 3)" in status names indicates the judge forced a retry.
function retryDepth(statuses) {
    let depth = 0;
    for (const s of statuses) {
        const m = s.match(/\(step (\d+)\)/);
        if (m) depth = Math.max(depth, parseInt(m[1], 10) - 1);
    }
    return depth;
}

// ── Aggregate token counts by model ──────────────────────────────────────────
function aggregateByModel(calls) {
    const byModel = {};
    for (const c of calls) {
        if (!byModel[c.model]) byModel[c.model] = { in: 0, out: 0, calls: 0 };
        byModel[c.model].in    += c.inputTokens;
        byModel[c.model].out   += c.outputTokens;
        byModel[c.model].calls += 1;
    }
    return byModel;
}

async function runTurn(text, history) {
    const statuses = [];
    const t0 = Date.now();

    let response = '';
    let tokens = { inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: [] };

    try {
        const result = await feralChatHeadless(
            text,
            (s) => statuses.push(s),
            undefined,
            undefined,
            undefined,
            history,
        );
        response = result.response;
        tokens   = result.tokens;
    } catch (err) {
        response = `[ERROR] ${err.message}`;
    }

    return { response, statuses, ms: Date.now() - t0, tokens };
}

async function runSuite(pipelineKey) {
    const key = `pipeline.${pipelineKey}`;
    setActivePipeline(key);

    console.log(`\n${bar('═')}`);
    console.log(`${BOLD}Pipeline: ${CYAN}${key}${RESET}`);
    console.log(bar('═'));

    const results = [];

    // ── Single-turn prompts ───────────────────────────────────────────────────
    for (const prompt of PROMPTS) {
        console.log(`\n${YELLOW}[${prompt.label}]${RESET} ${prompt.text}`);
        console.log(`${DIM}expected: ${prompt.expect}${RESET}`);

        process.stdout.write(`${DIM}running…${RESET}`);
        const { response, statuses, ms, tokens } = await runTurn(prompt.text, []);
        process.stdout.write(`\r\x1b[2K`);

        const ok      = response.length > 0 && !response.startsWith('[ERROR]');
        const retries = retryDepth(statuses);
        console.log(`${ok ? PASS : FAIL} ${DIM}${ms}ms${RESET}  tokens: ${fmt(tokens.totalTokens)} (in ${fmt(tokens.inputTokens)} / out ${fmt(tokens.outputTokens)})  retries: ${retries}  [${statuses.join(' → ')}]`);
        console.log(response.slice(0, 300) + (response.length > 300 ? '…' : ''));

        results.push({ label: prompt.label, ok, ms, tokens, retries });
    }

    // ── Multi-turn sessions ───────────────────────────────────────────────────
    for (const session of SESSIONS) {
        console.log(`\n${bar('─')}`);
        console.log(`${BOLD}Session: ${BLUE}${session.label}${RESET}`);
        console.log(`${DIM}${session.expect}${RESET}`);

        const history = [];
        let sessionOk = true;

        for (const turn of session.turns) {
            console.log(`\n  ${YELLOW}[${turn.label}]${RESET} ${turn.text}`);
            console.log(`  ${DIM}expected: ${turn.expect}${RESET}`);

            process.stdout.write(`  ${DIM}running…${RESET}`);
            const { response, statuses, ms, tokens } = await runTurn(turn.text, [...history]);
            process.stdout.write(`\r\x1b[2K`);

            const ok      = response.length > 0 && !response.startsWith('[ERROR]');
            const retries = retryDepth(statuses);
            if (!ok) sessionOk = false;

            console.log(`  ${ok ? PASS : FAIL} ${DIM}${ms}ms${RESET}  tokens: ${fmt(tokens.totalTokens)} (in ${fmt(tokens.inputTokens)} / out ${fmt(tokens.outputTokens)})  retries: ${retries}`);
            console.log(`  ${DIM}[${statuses.join(' → ')}]${RESET}`);
            console.log('  ' + response.slice(0, 300).replace(/\n/g, '\n  ') + (response.length > 300 ? '…' : ''));

            history.push({ role: 'user',      content: turn.text });
            history.push({ role: 'assistant', content: response });

            results.push({ label: `${session.label} / ${turn.label}`, ok, ms, tokens, retries });
        }

        console.log(`\n  ${sessionOk ? PASS : FAIL} Session ${session.label} ${sessionOk ? 'passed' : 'had failures'}`);
    }

    const passed    = results.filter(r => r.ok).length;
    const firstTry  = results.filter(r => r.ok && r.retries === 0).length;
    const avgMs     = Math.round(results.reduce((s, r) => s + r.ms, 0) / results.length);
    const totalIn   = results.reduce((s, r) => s + r.tokens.inputTokens, 0);
    const totalOut  = results.reduce((s, r) => s + r.tokens.outputTokens, 0);
    const allCalls  = results.flatMap(r => r.tokens.calls);
    const byModel   = aggregateByModel(allCalls);

    console.log(`\n${bar()}`);
    console.log(`${BOLD}${pipelineKey}${RESET}: ${passed}/${results.length} passed   first-try: ${firstTry}/${passed}   avg ${avgMs}ms`);
    console.log(`${MAGENTA}Tokens${RESET}: ${fmt(totalIn + totalOut)} total  (in ${fmt(totalIn)} / out ${fmt(totalOut)})  across ${allCalls.length} LLM calls`);
    for (const [model, u] of Object.entries(byModel)) {
        console.log(`  ${DIM}${model}: ${fmt(u.in + u.out)} tokens (in ${fmt(u.in)} / out ${fmt(u.out)}) × ${u.calls} calls${RESET}`);
    }

    return results;
}

console.log(`${BOLD}Phaibel Pipeline Test${RESET}`);
console.log(`Vault: ${process.env.PHAIBEL_VAULT}`);
console.log(`Pipelines: ${PIPELINES.join(', ')}`);

const allResults = {};
for (const p of PIPELINES) {
    allResults[p] = await runSuite(p);
}

// ── Final summary ─────────────────────────────────────────────────────────────
console.log(`\n${bar('═')}`);
console.log(`${BOLD}Summary${RESET}`);

let grandIn = 0, grandOut = 0, grandCalls = 0;

for (const [p, results] of Object.entries(allResults)) {
    const passed   = results.filter(r => r.ok).length;
    const firstTry = results.filter(r => r.ok && r.retries === 0).length;
    const avgMs    = Math.round(results.reduce((s, r) => s + r.ms, 0) / results.length);
    const totalIn  = results.reduce((s, r) => s + r.tokens.inputTokens, 0);
    const totalOut = results.reduce((s, r) => s + r.tokens.outputTokens, 0);
    const calls    = results.flatMap(r => r.tokens.calls).length;
    const icon     = passed === results.length ? PASS : FAIL;

    grandIn    += totalIn;
    grandOut   += totalOut;
    grandCalls += calls;

    console.log(`  ${icon} ${p.padEnd(16)} ${passed}/${results.length} pass  first-try ${firstTry}/${passed}  avg ${avgMs}ms  ${fmt(totalIn + totalOut)} tokens (${calls} calls)`);
}

if (PIPELINES.length > 1) {
    console.log(`  ${'─'.repeat(66)}`);
    console.log(`  ${'total'.padEnd(18)} ${' '.repeat(16)} ${fmt(grandIn + grandOut)} tokens (${grandCalls} calls)  in ${fmt(grandIn)} / out ${fmt(grandOut)}`);
}

console.log(bar('═'));
