// ─────────────────────────────────────────────────────────────────────────────
// Feral Agent — Generate Markdown NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { AbstractNodeCode } from '../../node-code/abstract-node-code.js';
import { NodeCodeCategory } from '../../node-code/node-code.js';
import { ResultStatus } from '../../result/result.js';
/**
 * Generates Markdown from structured context data or a template.
 */
export class GenerateMarkdownNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'input_context_path', name: 'Input Path', description: 'Context path with structured data or sections array', type: 'string' },
        { key: 'output_context_path', name: 'Output Path', description: 'Context path for the generated Markdown', type: 'string', isOptional: true, default: 'markdown_data' },
        { key: 'template_context_path', name: 'Template Path', description: 'Optional: context path for a Markdown template with {placeholder} interpolation', type: 'string', isOptional: true },
    ];
    constructor() {
        super('generate_markdown', 'Generate Markdown', 'Generates Markdown from structured data', NodeCodeCategory.DATA);
    }
    async process(context) {
        const inputPath = this.getRequiredConfigValue('input_context_path');
        const outputPath = this.getOptionalConfigValue('output_context_path', 'markdown_data');
        const templatePath = this.getOptionalConfigValue('template_context_path');
        if (!context.has(inputPath)) {
            return this.result(ResultStatus.ERROR, `No data at context path "${inputPath}"`);
        }
        // Template mode: interpolate {placeholders} in a Markdown template
        if (templatePath && context.has(templatePath)) {
            const template = String(context.get(templatePath));
            const data = context.get(inputPath);
            const result = template.replace(/\{(\w+)\}/g, (_, key) => {
                return data[key] !== undefined ? String(data[key]) : `{${key}}`;
            });
            context.set(outputPath, result);
            return this.result(ResultStatus.OK, `Generated Markdown from template`);
        }
        // Structured mode: convert MarkdownSection[] to Markdown string
        const input = context.get(inputPath);
        const sections = Array.isArray(input) ? input : [input];
        const lines = [];
        for (const section of sections) {
            lines.push(this.renderSection(section));
            lines.push(''); // blank line between sections
        }
        context.set(outputPath, lines.join('\n').trim());
        return this.result(ResultStatus.OK, `Generated Markdown with ${sections.length} section(s)`);
    }
    renderSection(section) {
        switch (section.type) {
            case 'heading': {
                const level = Math.min(Math.max(section.level ?? 1, 1), 6);
                return `${'#'.repeat(level)} ${section.content ?? ''}`;
            }
            case 'paragraph':
                return section.content ?? '';
            case 'blockquote':
                return (section.content ?? '').split('\n').map(l => `> ${l}`).join('\n');
            case 'list': {
                const items = section.items ?? [];
                return items.map((item, i) => {
                    const bullet = section.ordered ? `${i + 1}.` : '-';
                    return `${bullet} ${item}`;
                }).join('\n');
            }
            case 'table': {
                const headers = section.headers ?? [];
                const rows = section.rows ?? [];
                if (headers.length === 0)
                    return '';
                const headerLine = `| ${headers.join(' | ')} |`;
                const separatorLine = `| ${headers.map(() => '---').join(' | ')} |`;
                const rowLines = rows.map(r => `| ${r.join(' | ')} |`);
                return [headerLine, separatorLine, ...rowLines].join('\n');
            }
            case 'code':
                return `\`\`\`${section.language ?? ''}\n${section.content ?? ''}\n\`\`\``;
            default:
                return section.content ?? '';
        }
    }
}
