// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — HTML → Markdown NodeCode
// ─────────────────────────────────────────────────────────────────────────────
// Converts simple HTML (bold, em, links, ul/ol, tables, headings, etc.) in a
// context value into Markdown, so downstream Markdown→HTML rendering in the
// desktop/mobile (and the block system) displays it correctly. Run this before
// emitting content as Markdown / blocks.

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { htmlToMarkdown } from '../../../utils/html-to-markdown.js';

export class HtmlToMarkdownNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'source', name: 'Source', description: 'Context key holding the HTML string to convert.', type: 'string' },
        { key: 'context_path', name: 'Context Path', description: 'Where to store the resulting Markdown (defaults to overwriting the source).', type: 'string', isOptional: true },
    ];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'HTML converted to Markdown.' },
        { status: ResultStatus.ERROR, description: 'Conversion failed.' },
    ];

    constructor() {
        super('html_to_markdown', 'HTML to Markdown', 'Converts simple HTML (bold, italic, links, lists, tables, headings) into Markdown.', NodeCodeCategory.WORK);
    }

    async process(context: Context): Promise<Result> {
        const source = this.getRequiredConfigValue('source') as string;
        const target = (this.getOptionalConfigValue('context_path', source) as string) || source;
        try {
            const html = String(context.get(source) ?? '');
            const markdown = htmlToMarkdown(html);
            context.set(target, markdown);
            return this.result(ResultStatus.OK, markdown);
        } catch (error) {
            return this.result(ResultStatus.ERROR, `HTML→Markdown failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
