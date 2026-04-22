// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Stop NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
export class StopNodeCode extends AbstractNodeCode {
    static configDescriptions = [];
    static resultDescriptions = [
        { status: ResultStatus.STOP, description: 'The process has been stopped.' },
    ];
    constructor() {
        super('stop', 'Stop Process', 'The node that stops a process.', NodeCodeCategory.FLOW);
    }
    async process(_context) {
        return this.result(ResultStatus.STOP, 'Stop processing.');
    }
}
