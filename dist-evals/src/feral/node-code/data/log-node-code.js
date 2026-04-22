// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Log NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
export class LogNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'message', name: 'Message', description: 'Log message template. Use {context_key} for interpolation.', type: 'string' },
        { key: 'level', name: 'Level', description: 'Log level.', type: 'string', default: 'info', options: ['debug', 'info', 'warn', 'error'], isOptional: true },
    ];
    static resultDescriptions = [
        { status: ResultStatus.OK, description: 'Message was logged.' },
    ];
    /** Override this to redirect output (useful for testing) */
    logger = (level, message) => {
        switch (level) {
            case 'debug':
                console.debug(`[feral] ${message}`);
                break;
            case 'warn':
                console.warn(`[feral] ${message}`);
                break;
            case 'error':
                console.error(`[feral] ${message}`);
                break;
            default: console.log(`[feral] ${message}`);
        }
    };
    constructor() {
        super('log', 'Log Message', 'Logs a message with template interpolation from context values.', NodeCodeCategory.DATA);
    }
    async process(context) {
        const template = this.getRequiredConfigValue('message');
        const level = this.getOptionalConfigValue('level', 'info');
        // Interpolate {key} references with context values
        const message = template.replace(/\{(\w+)\}/g, (_, key) => {
            return String(context.get(key) ?? '');
        });
        this.logger(level, message);
        return this.result(ResultStatus.OK, message);
    }
}
