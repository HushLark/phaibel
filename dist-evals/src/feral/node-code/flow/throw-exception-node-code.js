// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Throw Exception NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { ProcessError } from '../../errors.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
export class ThrowExceptionNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'message', name: 'Message', description: 'The error message to throw.', type: 'string', default: 'Intentional exception from ThrowExceptionNodeCode.' },
    ];
    static resultDescriptions = [];
    constructor() {
        super('throw_exception', 'Throw Exception', 'Throws an exception (for testing).', NodeCodeCategory.FLOW);
    }
    async process(_context) {
        const message = this.getRequiredConfigValue('message', 'Intentional exception from ThrowExceptionNodeCode.');
        throw new ProcessError(message);
    }
}
