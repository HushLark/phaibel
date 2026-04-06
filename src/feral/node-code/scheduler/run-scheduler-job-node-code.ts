// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Run Scheduler Job NodeCode
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { getCronScheduler } from '../../../service/cron/scheduler.js';

export class RunSchedulerJobNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        {
            key: 'job_name',
            name: 'Job Name',
            description: 'The scheduler job name to run immediately (e.g. "cal-sync", "world-model").',
            type: 'string',
        },
        {
            key: 'context_path',
            name: 'Context Path',
            description: 'Context key to store the run result.',
            type: 'string',
            default: 'scheduler_run_result',
            isOptional: true,
        },
    ];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Job executed successfully.' },
        { status: ResultStatus.ERROR, description: 'Job execution failed.' },
    ];

    constructor() {
        super(
            'run_scheduler_job',
            'Run Scheduler Job',
            'Immediately executes a scheduler job by name and returns the result.',
            NodeCodeCategory.DATA,
        );
    }

    async process(context: Context): Promise<Result> {
        const jobName = this.getRequiredConfigValue('job_name') as string;
        const contextPath = this.getOptionalConfigValue('context_path', 'scheduler_run_result') as string;

        try {
            const scheduler = getCronScheduler();
            const result = await scheduler.runJob(jobName);
            context.set(contextPath, { job: jobName, result });
            return this.result(ResultStatus.OK, `Job "${jobName}" completed: ${result}`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            context.set(contextPath, { job: jobName, error: msg });
            return this.result(ResultStatus.ERROR, `Job "${jobName}" failed: ${msg}`);
        }
    }
}
