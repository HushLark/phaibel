// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Emit Blocks NodeCode
// ─────────────────────────────────────────────────────────────────────────────
// Renders a Phaibel block message into the chat UI. Blocks are the app's rich
// UI vocabulary (markdown text, fields, lists, dividers, and action buttons).
// Action buttons carry a `kind` (+ optional payload) dispatched by the desktop's
// action registry — including `runProcess` to call another Feral process.
//
// The `blocks` config may be a JSON string or an already-parsed array (when a
// process supplies it directly). It also resolves a `{context_key}` reference.
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { pushBlocks } from '../../../service/web-server.js';
import { blocksToMarkdown } from '../../../utils/blocks-to-markdown.js';

export class EmitBlocksNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'blocks', name: 'Blocks', description: 'Phaibel blocks as a JSON array (or a {context_key} holding one). Block types: markdown, heading, context, divider, fields, list, actions.', type: 'string' },
        { key: 'message', name: 'Message', description: 'Optional plain-text fallback shown above the blocks.', type: 'string', isOptional: true },
    ];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Blocks emitted to the chat UI.' },
        { status: ResultStatus.ERROR, description: 'Blocks were missing or not valid JSON.' },
    ];

    constructor() {
        super('emit_blocks', 'Emit Blocks', 'Renders a rich block UI message (markdown, fields, action buttons) into the chat.', NodeCodeCategory.WORK);
    }

    async process(context: Context): Promise<Result> {
        const raw = this.getRequiredConfigValue('blocks');
        const message = (this.getOptionalConfigValue('message', '') as string) || '';

        let blocks: unknown;
        try {
            if (Array.isArray(raw)) {
                blocks = raw;
            } else if (typeof raw === 'string') {
                // Allow a {context_key} reference to an array already in context.
                const ref = raw.trim().match(/^\{(\w+)\}$/);
                blocks = ref ? context.get(ref[1]) : JSON.parse(raw);
            } else {
                blocks = raw;
            }
        } catch (err) {
            return this.result(ResultStatus.ERROR, `Invalid blocks JSON: ${err instanceof Error ? err.message : String(err)}`);
        }

        if (!Array.isArray(blocks)) {
            return this.result(ResultStatus.ERROR, 'Blocks must be an array.');
        }

        // Desktop renders the rich blocks; mobile / text-only surfaces get a
        // Markdown serialization via the process output.
        pushBlocks(blocks, message);
        context.set('output', message || blocksToMarkdown(blocks));
        return this.result(ResultStatus.OK, `Emitted ${blocks.length} block(s).`);
    }
}
