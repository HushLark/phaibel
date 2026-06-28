// One-shot headless chat runner for testing CF/x3 scoping + connection introspection.
//   PHAIBEL_VAULT=<vault> npx tsx scripts/cfx3-headless-test.mts "your question"
// Defaults to a small suite if no prompt is given.

import { feralChatHeadless } from '../src/commands/chat.js';

const prompts = process.argv.slice(2);
const suite = prompts.length > 0 ? prompts : [
    'what calendars am I connected to?',
    'what sources am I connected to?',
    'in HushLark, what plans are available?',
];

for (const p of suite) {
    process.stderr.write(`\n\n=== Q: ${p}\n`);
    const onStatus = (s: string) => process.stderr.write(`  · ${s}\n`);
    try {
        const { response } = await feralChatHeadless(p, onStatus);
        process.stdout.write(`\n>>> A: ${response}\n`);
    } catch (e) {
        process.stdout.write(`\n!!! ERROR: ${e instanceof Error ? e.stack : String(e)}\n`);
    }
}
process.exit(0);
