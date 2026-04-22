import { bootstrapFeral } from '../feral/bootstrap.js';
import { registerServiceTool } from './types.js';
// ─────────────────────────────────────────────────────────────────────────────
// TIME TOOL (V2) — Feral-backed
// ─────────────────────────────────────────────────────────────────────────────
registerServiceTool({
    name: 'time',
    description: 'Shows the current local time',
    type: 'deterministic',
    execute: async (_input, context) => {
        const feral = await bootstrapFeral();
        const ctx = await feral.runner.run('system.time');
        const time = ctx.getString('current_time');
        context.log.info(`Current time: ${time}`);
        return {
            success: true,
            output: `The current time is: ${time}`,
        };
    },
});
