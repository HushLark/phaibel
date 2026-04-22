// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — List Processes NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
export class ListProcessesNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'context_path', name: 'Context Path', description: 'Context key to store the process list.', type: 'string', isOptional: true, default: 'processes' },
    ];
    static resultDescriptions = [
        { status: 'ok', description: 'Processes listed successfully.' },
    ];
    processFactory;
    constructor(processFactory) {
        super('list_processes', 'List Processes', 'Lists all available reusable processes with their keys and descriptions.', NodeCodeCategory.DATA);
        this.processFactory = processFactory;
    }
    async process(context) {
        const contextPath = this.getOptionalConfigValue('context_path', 'processes');
        const processes = this.processFactory.getAllProcesses()
            .filter(p => p.key !== 'chat.generated')
            .map(p => ({ key: p.key, description: p.description }));
        context.set(contextPath, processes);
        return this.result(ResultStatus.OK, `Found ${processes.length} process(es).`);
    }
}
