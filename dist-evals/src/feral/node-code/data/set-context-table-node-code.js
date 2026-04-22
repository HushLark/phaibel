// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Set Context Table NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
export class SetContextTableNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'table', name: 'Table', description: 'A JSON object of key-value pairs to set in the context.', type: 'string' },
    ];
    static resultDescriptions = [
        { status: ResultStatus.OK, description: 'All values were set successfully.' },
    ];
    constructor() {
        super('set_context_table', 'Set Data Table', 'Sets multiple context values from a key-value map.', NodeCodeCategory.DATA);
    }
    async process(context) {
        const tableRaw = this.getRequiredConfigValue('table');
        let table;
        if (typeof tableRaw === 'string') {
            table = JSON.parse(tableRaw);
        }
        else {
            table = tableRaw;
        }
        let count = 0;
        for (const [key, value] of Object.entries(table)) {
            context.set(key, value);
            count++;
        }
        return this.result(ResultStatus.OK, `Set ${count} context value(s).`);
    }
}
