// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Noop NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
export class NoopNodeCode extends AbstractNodeCode {
    static configDescriptions = [];
    static resultDescriptions = [
        { status: ResultStatus.OK, description: 'No operation performed.' },
    ];
    constructor() {
        super('noop', 'No Operation', 'Does nothing, returns OK.', NodeCodeCategory.FLOW);
    }
    async process(_context) {
        return this.result(ResultStatus.OK, 'No operation.');
    }
}
