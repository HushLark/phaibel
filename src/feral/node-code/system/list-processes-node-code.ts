// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — List Processes NodeCode
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import type { ProcessFactory } from '../../process/process-factory.js';

export class ListProcessesNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'context_path', name: 'Context Path', description: 'Context key to store the process list.', type: 'string', isOptional: true, default: 'processes' },
    ];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: 'ok', description: 'Processes listed successfully.' },
    ];
    private processFactory: ProcessFactory;

    constructor(processFactory: ProcessFactory) {
        super(
            'list_processes',
            'List Processes',
            'Lists all available reusable processes with their keys and descriptions.',
            NodeCodeCategory.DATA,
        );
        this.processFactory = processFactory;
    }

    async process(context: Context): Promise<Result> {
        const contextPath = this.getOptionalConfigValue('context_path', 'processes') as string;

        const processes = this.processFactory.getAllProcesses()
            .filter(p => p.key !== 'chat.generated')
            .map(p => ({ key: p.key, description: p.description }));

        context.set(contextPath, processes);
        return this.result(ResultStatus.OK, `Found ${processes.length} process(es).`);
    }
}
