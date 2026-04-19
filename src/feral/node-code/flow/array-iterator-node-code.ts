// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Array Iterator NodeCode
// ─────────────────────────────────────────────────────────────────────────────
//
// Iterates over an array stored in context.  Each invocation advances a cursor,
// spreads the current item's fields into context, and returns 'ok'.
// When the array is exhausted it returns 'done', providing the loop-exit edge.
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';

const DONE = 'done';

export class ArrayIteratorNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        {
            key: 'source_context_path',
            name: 'Source Array Path',
            description: 'Context key containing the array to iterate.',
            type: 'string',
        },
        {
            key: 'cursor_context_path',
            name: 'Cursor Path',
            description: 'Context key for the internal cursor (auto-managed).',
            type: 'string',
            default: '_iterator_cursor',
        },
        {
            key: 'item_context_path',
            name: 'Item Path',
            description: 'Context key to store the current item object.',
            type: 'string',
            default: '_current_item',
            isOptional: true,
        },
        {
            key: 'spread_fields',
            name: 'Spread Fields',
            description: 'If true, spread the item\'s own properties directly into the context (useful for create_entity).',
            type: 'string',
            default: 'true',
            isOptional: true,
        },
        {
            key: 'max_iterations',
            name: 'Max Iterations',
            description: 'Maximum number of items to iterate over. Omit or set to 0 for no limit.',
            type: 'string',
            default: '0',
            isOptional: true,
        },
    ];

    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Item loaded into context; more items remain.' },
        { status: DONE, description: 'Array exhausted; no more items.' },
    ];

    constructor() {
        super(
            'array_iterator',
            'Array Iterator',
            'Iterates over a context array, spreading each item into context. Returns ok/done for loop control.',
            NodeCodeCategory.FLOW,
        );
    }

    async process(context: Context): Promise<Result> {
        const sourcePath = this.getRequiredConfigValue('source_context_path') as string;
        const cursorPath = this.getRequiredConfigValue('cursor_context_path', '_iterator_cursor') as string;
        const itemPath = this.getOptionalConfigValue('item_context_path', '_current_item') as string;
        const spreadFields = (this.getOptionalConfigValue('spread_fields', 'true') as string) === 'true';
        const maxIterations = parseInt(this.getOptionalConfigValue('max_iterations', '0') as string, 10) || 0;

        const arr = context.getArray(sourcePath);

        if (!Array.isArray(arr) || arr.length === 0) {
            return this.result(DONE, 'Source array is empty or not an array.');
        }

        // Read or initialize cursor
        const cursor = context.has(cursorPath) ? context.getInt(cursorPath) : 0;

        if (cursor >= arr.length || (maxIterations > 0 && cursor >= maxIterations)) {
            // Reset cursor for potential re-use and signal done
            context.set(cursorPath, 0);
            return this.result(DONE, `Iterated all ${arr.length} items.`);
        }

        const item = arr[cursor];

        // Store the whole item
        context.set(itemPath, item);

        // Spread item fields into context for downstream nodes
        if (spreadFields && item && typeof item === 'object' && !Array.isArray(item)) {
            for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
                context.set(key, value);
            }
        }

        // Advance cursor
        context.set(cursorPath, cursor + 1);

        return this.result(ResultStatus.OK, `Item ${cursor + 1}/${arr.length}: ${JSON.stringify(item).slice(0, 100)}`);
    }
}
