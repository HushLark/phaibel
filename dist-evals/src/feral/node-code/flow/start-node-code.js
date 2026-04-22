// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Start NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
export class StartNodeCode extends AbstractNodeCode {
    static configDescriptions = [];
    static resultDescriptions = [
        { status: ResultStatus.OK, description: 'The start node was successful.' },
    ];
    constructor() {
        super('start', 'Start Process', 'The node that starts a process.', NodeCodeCategory.FLOW);
    }
    async process(_context) {
        return this.result(ResultStatus.OK, 'Start processing.');
    }
}
