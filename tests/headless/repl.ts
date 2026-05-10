#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Headless Phaibel REPL — interactive test harness
//
// Usage (after npm run build):
//   npm run headless
//   npm run headless -- "single command"
//
// Points PHAIBEL_VAULT at the seeded test vault in tests/headless/vault/.
// Maintains conversation history across turns so context carries forward.
// ─────────────────────────────────────────────────────────────────────────────

import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VAULT_PATH = path.resolve(__dirname, 'vault');

// Point Phaibel at the test vault before any other imports
process.env.PHAIBEL_VAULT = VAULT_PATH;

// Import from compiled dist — avoids tsx/esbuild issues with WASM (local embeddings)
const { feralChatHeadless } = await import('../../dist/commands/chat.js');

const history = [];

function printSeparator() {
    console.log('\n' + '─'.repeat(60) + '\n');
}

async function ask(question, options) {
    if (options && options.length > 0) {
        console.log(`\n\x1b[33mQuestion:\x1b[0m ${question}`);
        options.forEach((o, i) => console.log(`  ${i + 1}. ${o}`));
        return new Promise((resolve) => {
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            rl.question('Select (number or text): ', (answer) => {
                rl.close();
                const idx = parseInt(answer, 10);
                resolve(!isNaN(idx) && idx >= 1 && idx <= options.length ? options[idx - 1] : answer);
            });
        });
    }
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(`\x1b[33m${question}\x1b[0m `, (answer) => { rl.close(); resolve(answer); });
    });
}

async function send(input) {
    let statusLine = '';

    const result = await feralChatHeadless(
        input,
        (status) => {
            process.stdout.write(`\r\x1b[2K\x1b[90m${status}\x1b[0m`);
            statusLine = status;
        },
        undefined,
        ask,
        undefined,
        history,
    );

    if (statusLine) process.stdout.write('\r\x1b[2K');

    history.push({ role: 'user', content: input });
    history.push({ role: 'assistant', content: result.response });
    while (history.length > 6) history.splice(0, 2);

    return result.response;
}

async function runSingle(input) {
    console.log(`\x1b[36mYou:\x1b[0m ${input}`);
    printSeparator();
    const response = await send(input);
    console.log(response);
    printSeparator();
}

async function runRepl() {
    console.log('\x1b[1mHeadless Phaibel — Test Vault\x1b[0m');
    console.log(`Vault: ${VAULT_PATH}`);
    console.log('Type a message and press Enter. Ctrl+C to exit.\n');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: '\x1b[36mYou:\x1b[0m ',
    });

    rl.prompt();

    rl.on('line', async (line) => {
        const input = line.trim();
        if (!input) { rl.prompt(); return; }

        rl.pause();
        printSeparator();

        try {
            const response = await send(input);
            console.log(response);
        } catch (err) {
            console.error(`\x1b[31mError:\x1b[0m ${err}`);
        }

        printSeparator();
        rl.resume();
        rl.prompt();
    });

    rl.on('close', () => {
        console.log('\nGoodbye.');
        process.exit(0);
    });
}

const singleCommand = process.argv[2];
if (singleCommand) {
    await runSingle(singleCommand);
} else {
    await runRepl();
}
