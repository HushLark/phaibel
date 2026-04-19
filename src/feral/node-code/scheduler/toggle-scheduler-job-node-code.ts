// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Toggle Scheduler Job NodeCode
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { getCronScheduler, loadCronConfig, saveCronConfig } from '../../../service/cron/scheduler.js';

export class ToggleSchedulerJobNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        {
            key: 'job_name',
            name: 'Job Name',
            description: 'The scheduler job name to toggle (e.g. "cal-sync", "embedding-sync").',
            type: 'string',
        },
        {
            key: 'action',
            name: 'Action',
            description: 'Action to perform: "enable", "disable", or "toggle".',
            type: 'string',
            default: 'toggle',
            isOptional: true,
        },
        {
            key: 'context_path',
            name: 'Context Path',
            description: 'Context key to store the result.',
            type: 'string',
            default: 'scheduler_toggle_result',
            isOptional: true,
        },
    ];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Job toggled successfully.' },
        { status: ResultStatus.ERROR, description: 'Failed to toggle job.' },
    ];

    constructor() {
        super(
            'toggle_scheduler_job',
            'Toggle Scheduler Job',
            'Enables, disables, or toggles a scheduler job by name.',
            NodeCodeCategory.DATA,
        );
    }

    async process(context: Context): Promise<Result> {
        const jobName = this.getRequiredConfigValue('job_name') as string;
        const action = (this.getOptionalConfigValue('action', 'toggle') as string).toLowerCase();
        const contextPath = this.getOptionalConfigValue('context_path', 'scheduler_toggle_result') as string;

        const config = await loadCronConfig();
        const jobConfig = config.jobs[jobName];
        if (!jobConfig) {
            context.set(contextPath, { error: `Unknown job: ${jobName}` });
            return this.result(ResultStatus.ERROR, `Unknown scheduler job: "${jobName}"`);
        }

        if (action === 'enable') {
            jobConfig.enabled = true;
        } else if (action === 'disable') {
            jobConfig.enabled = false;
        } else {
            jobConfig.enabled = !jobConfig.enabled;
        }

        await saveCronConfig(config);
        await getCronScheduler().reload();

        const newState = jobConfig.enabled ? 'enabled' : 'disabled';
        context.set(contextPath, { job: jobName, enabled: jobConfig.enabled });
        return this.result(ResultStatus.OK, `Scheduler job "${jobName}" is now ${newState}.`);
    }
}
