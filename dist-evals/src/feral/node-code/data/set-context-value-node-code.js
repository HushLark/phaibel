// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Set Context Value NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
export class SetContextValueNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'value', name: 'Value', description: 'The value to set in the context.', type: 'string' },
        { key: 'context_path', name: 'Context Path', description: 'The key in the context to set.', type: 'string' },
        { key: 'value_type', name: 'Value Type', description: 'Type cast for the value.', type: 'string', default: 'string', options: ['string', 'number', 'int', 'float', 'boolean', 'json', 'date', 'datetime'] },
    ];
    static resultDescriptions = [
        { status: ResultStatus.OK, description: 'Value was set successfully.' },
    ];
    constructor() {
        super('set_context_value', 'Set Data Value', 'Sets a typed value in the context.', NodeCodeCategory.DATA);
    }
    async process(context) {
        const valueType = this.getRequiredConfigValue('value_type', 'string');
        const rawValue = this.getRequiredConfigValue('value');
        const contextPath = this.getRequiredConfigValue('context_path');
        let value;
        switch (valueType) {
            case 'string':
                value = String(rawValue);
                break;
            case 'int':
                value = parseInt(String(rawValue), 10);
                break;
            case 'number':
            case 'float':
                value = parseFloat(String(rawValue));
                break;
            case 'boolean':
                value = rawValue === 'true' || rawValue === '1';
                break;
            case 'json':
                try {
                    value = JSON.parse(String(rawValue));
                }
                catch {
                    value = rawValue;
                }
                break;
            case 'date': {
                // Accept YYYY-MM-DD. Also handle natural-ish values like timestamps.
                const dateStr = String(rawValue).trim();
                const dateMatch = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
                if (dateMatch) {
                    value = dateMatch[1];
                }
                else {
                    // Try parsing as a Date and formatting
                    const parsed = new Date(dateStr);
                    if (!isNaN(parsed.getTime())) {
                        value = parsed.toISOString().split('T')[0];
                    }
                    else {
                        value = dateStr; // pass through, let validator catch it
                    }
                }
                break;
            }
            case 'datetime': {
                const dtStr = String(rawValue).trim();
                // If already ISO 8601 with timezone offset (e.g. 2026-03-25T14:00:00-06:00), keep as-is
                if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/.test(dtStr)) {
                    value = dtStr;
                }
                else {
                    // Parse and convert to ISO — fallback to UTC
                    const parsed = new Date(dtStr);
                    if (!isNaN(parsed.getTime())) {
                        value = parsed.toISOString();
                    }
                    else {
                        value = dtStr; // pass through, let validator catch it
                    }
                }
                break;
            }
            default: throw new Error(`Unknown value_type "${valueType}".`);
        }
        context.set(contextPath, value);
        return this.result(ResultStatus.OK, `Set "${contextPath}" = ${JSON.stringify(value)}.`);
    }
}
