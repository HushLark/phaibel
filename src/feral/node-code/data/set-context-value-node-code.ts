// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Set Context Value NodeCode
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';

export class SetContextValueNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'value', name: 'Value', description: 'The value to set in the context.', type: 'string' },
        { key: 'context_path', name: 'Context Path', description: 'The key in the context to set.', type: 'string' },
        { key: 'value_type', name: 'Value Type', description: 'Type cast for the value.', type: 'string', default: 'string', options: ['string', 'number', 'int', 'float', 'boolean', 'json', 'date', 'datetime'] },
    ];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Value was set successfully.' },
    ];

    constructor() {
        super('set_context_value', 'Set Data Value', 'Sets a typed value in the context.', NodeCodeCategory.DATA);
    }

    async process(context: Context): Promise<Result> {
        const valueType = this.getRequiredConfigValue('value_type', 'string') as string;
        const rawValue = this.getRequiredConfigValue('value') as string;
        const contextPath = this.getRequiredConfigValue('context_path') as string;

        let value: unknown;
        switch (valueType) {
            case 'string': value = String(rawValue); break;
            case 'int': value = parseInt(String(rawValue), 10); break;
            case 'number':
            case 'float': value = parseFloat(String(rawValue)); break;
            case 'boolean': value = rawValue === 'true' || rawValue === '1'; break;
            case 'json':
                try { value = JSON.parse(String(rawValue)); }
                catch { value = rawValue; }
                break;
            case 'date': {
                // Accept YYYY-MM-DD. Also handle natural-ish values like timestamps.
                const dateStr = String(rawValue).trim();
                const dateMatch = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
                if (dateMatch) {
                    value = dateMatch[1];
                } else {
                    // Try parsing as a Date and formatting
                    const parsed = new Date(dateStr);
                    if (!isNaN(parsed.getTime())) {
                        value = parsed.toISOString().split('T')[0];
                    } else {
                        value = dateStr; // pass through, let validator catch it
                    }
                }
                break;
            }
            case 'datetime': {
                const dtStr = String(rawValue).trim();
                const parsed = new Date(dtStr);
                if (!isNaN(parsed.getTime())) {
                    value = parsed.toISOString();
                } else {
                    value = dtStr; // pass through
                }
                break;
            }
            default: throw new Error(`Unknown value_type "${valueType}".`);
        }

        context.set(contextPath, value);
        return this.result(ResultStatus.OK, `Set "${contextPath}" = ${JSON.stringify(value)}.`);
    }
}
