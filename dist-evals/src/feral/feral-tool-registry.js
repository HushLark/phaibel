// ─────────────────────────────────────────────────────────────────────────────
// Feral Tool Registry
//
// Auto-generates ServiceTool objects from Feral processes that include
// a `tool` metadata block in their JSON definition.  This eliminates
// the need for hand-written registerServiceTool() wrappers for every
// CRUD operation.
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Scans all Feral processes for `tool` metadata and produces ServiceTool
 * objects with a generic execute() that delegates to runner.run().
 */
export class FeralToolRegistry {
    processFactory;
    runner;
    tools = new Map();
    constructor(processFactory, runner) {
        this.processFactory = processFactory;
        this.runner = runner;
        this.buildTools();
    }
    // ── Public API ──────────────────────────────────────────────────────
    getTool(name) {
        return this.tools.get(name);
    }
    hasTool(name) {
        return this.tools.has(name);
    }
    listTools() {
        return Array.from(this.tools.values());
    }
    // ── Internals ───────────────────────────────────────────────────────
    buildTools() {
        const processes = this.processFactory.getAllProcesses();
        for (const process of processes) {
            if (!process.tool)
                continue; // skip processes without tool metadata
            const meta = process.tool;
            const runner = this.runner;
            const processKey = process.key;
            const tool = {
                name: processKey,
                description: process.description || processKey,
                type: meta.type,
                ...(meta.capability && { capability: meta.capability }),
                ...(meta.input_schema && { inputSchema: meta.input_schema }),
                execute: async (input, context) => {
                    context.log.info(`Running Feral process: ${processKey}`);
                    const inputRecord = (input ?? {});
                    const ctx = await runner.run(processKey, inputRecord);
                    const output = ctx.get('output');
                    const error = ctx.get('error');
                    if (error) {
                        return { success: false, output: null, error: String(error) };
                    }
                    const result = {
                        success: true,
                        output: output ?? inputRecord,
                    };
                    // Apply canvas update if the process declares a canvas_type
                    if (meta.canvas_type) {
                        const title = inputRecord.title || '';
                        const content = inputRecord.content || '';
                        result.canvasUpdate = {
                            type: meta.canvas_type,
                            title,
                            content,
                            dirty: false,
                        };
                    }
                    return result;
                },
            };
            this.tools.set(processKey, tool);
        }
    }
}
