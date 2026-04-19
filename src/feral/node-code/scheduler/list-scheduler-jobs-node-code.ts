// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — List Scheduler Jobs NodeCode
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { getCronScheduler } from '../../../service/cron/scheduler.js';

export class ListSchedulerJobsNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        {
            key: 'context_path',
            name: 'Context Path',
            description: 'Context key to store the job list.',
            type: 'string',
            default: 'scheduler_jobs',
            isOptional: true,
        },
    ];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Scheduler jobs listed.' },
    ];

    constructor() {
        super(
            'list_scheduler_jobs',
            'List Scheduler Jobs',
            'Lists all scheduler jobs with their status, interval, last run time, and whether they are enabled or running.',
            NodeCodeCategory.DATA,
        );
    }

    async process(context: Context): Promise<Result> {
        const contextPath = this.getOptionalConfigValue('context_path', 'scheduler_jobs') as string;
        const scheduler = getCronScheduler();
        const status = scheduler.getStatus();
        context.set(contextPath, status.jobs);
        return this.result(ResultStatus.OK, `Found ${status.jobs.length} scheduler job(s).`);
    }
}
