// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Context Value Result NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
export class ContextValueResultNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'context_path', name: 'Context Path', description: 'The context key whose value will be used as the result status.', type: 'string' },
    ];
    static resultDescriptions = [
        { status: '*', description: 'The result status is the value of the specified context key.' },
    ];
    constructor() {
        super('context_value_result', 'Context Value Result', 'Returns a result whose status is read from a context key.', NodeCodeCategory.FLOW);
    }
    async process(context) {
        const contextPath = this.getRequiredConfigValue('context_path');
        const value = context.getString(contextPath);
        return this.result(value, `Context value at "${contextPath}" is "${value}".`);
    }
}
