// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Sort Entities NodeCode
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';

/**
 * Sort order maps for structured fields.
 */
const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const STATUS_ORDER: Record<string, number> = { open: 0, 'in-progress': 1, blocked: 2, done: 3 };

export class SortEntitiesNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'context_path', name: 'Context Path', description: 'Context key holding the entity array to sort.', type: 'string', default: 'entities' },
        { key: 'sort_by', name: 'Sort By', description: 'Comma-separated field names to sort by (e.g. priority,dueDate).', type: 'string', default: 'title' },
        { key: 'sort_order', name: 'Sort Order', description: 'Sort order: asc or desc.', type: 'string', default: 'asc' },
    ];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Entities sorted successfully.' },
    ];

    constructor() {
        super('sort_entities', 'Sort Entities', 'Sorts an entity array in context by configurable fields.', NodeCodeCategory.DATA);
    }

    async process(context: Context): Promise<Result> {
        const contextPath = this.getRequiredConfigValue('context_path', 'entities') as string;
        const sortByStr = this.getRequiredConfigValue('sort_by', 'title') as string;
        const sortOrder = this.getRequiredConfigValue('sort_order', 'asc') as string;

        const entities = context.get(contextPath) as Record<string, unknown>[];
        if (!entities || !Array.isArray(entities)) {
            return this.result(ResultStatus.OK, 'No entities to sort.');
        }

        const sortFields = sortByStr.split(',').map(f => f.trim()).filter(Boolean);
        const desc = sortOrder === 'desc';

        const sorted = [...entities].sort((a, b) => {
            for (const field of sortFields) {
                const va = a[field];
                const vb = b[field];

                let cmp: number;

                // Use special ordering for known enum fields
                if (field === 'priority') {
                    cmp = (PRIORITY_ORDER[String(va)] ?? 99) - (PRIORITY_ORDER[String(vb)] ?? 99);
                } else if (field === 'status') {
                    cmp = (STATUS_ORDER[String(va)] ?? 99) - (STATUS_ORDER[String(vb)] ?? 99);
                } else if (va == null && vb == null) {
                    cmp = 0;
                } else if (va == null) {
                    cmp = 1;
                } else if (vb == null) {
                    cmp = -1;
                } else {
                    cmp = String(va).localeCompare(String(vb));
                }

                if (cmp !== 0) return desc ? -cmp : cmp;
            }
            return 0;
        });

        context.set(contextPath, sorted);
        return this.result(ResultStatus.OK, `Sorted ${sorted.length} entities by ${sortByStr}.`);
    }
}
