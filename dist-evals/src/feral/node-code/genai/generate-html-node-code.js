// ─────────────────────────────────────────────────────────────────────────────
// Feral Agent — Generate HTML NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { AbstractNodeCode } from '../../node-code/abstract-node-code.js';
import { NodeCodeCategory } from '../../node-code/node-code.js';
import { ResultStatus } from '../../result/result.js';
/**
 * Converts Markdown content from context to HTML using the `marked` library.
 */
export class GenerateHtmlNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'source_context_path', name: 'Source Path', description: 'Context path containing the Markdown content', type: 'string' },
        { key: 'target_context_path', name: 'Target Path', description: 'Context path to store the HTML output', type: 'string', isOptional: true, default: 'html_output' },
        { key: 'wrap_html', name: 'Wrap HTML', description: 'Whether to wrap in an HTML document structure', type: 'boolean', isOptional: true, default: false },
    ];
    constructor() {
        super('convert_html', 'Convert to HTML', 'Converts Markdown to HTML', NodeCodeCategory.DATA);
    }
    async process(context) {
        const sourcePath = this.getRequiredConfigValue('source_context_path');
        const targetPath = this.getOptionalConfigValue('target_context_path', 'html_output');
        const wrapHtml = this.getOptionalConfigValue('wrap_html', false);
        if (!context.has(sourcePath)) {
            return this.result(ResultStatus.ERROR, `No Markdown content at context path "${sourcePath}"`);
        }
        const markdown = String(context.get(sourcePath));
        try {
            // Dynamic import of marked so it's only loaded when needed
            const { marked } = await import('marked');
            let html = await marked(markdown);
            if (wrapHtml) {
                html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body>${html}</body>
</html>`;
            }
            context.set(targetPath, html);
            return this.result(ResultStatus.OK, `Converted Markdown to HTML (${html.length} chars)`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.result(ResultStatus.ERROR, `HTML conversion error: ${message}`);
        }
    }
}
