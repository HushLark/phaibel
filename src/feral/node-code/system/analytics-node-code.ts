// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Analytics NodeCode
// ─────────────────────────────────────────────────────────────────────────────
//
// Lets Feral processes query usage analytics — chats, tokens, costs, entities.
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { getAnalyticsService } from '../../../analytics/analytics-service.js';

const VALID_TARGETS = ['today', 'summary', 'days', 'pricing'] as const;
type AnalyticsTarget = (typeof VALID_TARGETS)[number];

export class AnalyticsNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        {
            key: 'target',
            name: 'Target',
            description: `What analytics data to load: ${VALID_TARGETS.join(', ')}`,
            type: 'string',
        },
        {
            key: 'days',
            name: 'Days',
            description: 'Number of days to look back (for summary and days targets). Default 30.',
            type: 'string',
            default: '30',
            isOptional: true,
        },
        {
            key: 'context_path',
            name: 'Context Path',
            description: 'Context key to store the result.',
            type: 'string',
            default: 'analytics',
            isOptional: true,
        },
    ];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Analytics data loaded.' },
        { status: ResultStatus.ERROR, description: 'Failed to load analytics data.' },
    ];

    constructor() {
        super(
            'analytics',
            'Analytics',
            'Queries Phaibel usage analytics — today\'s stats, summary over N days, daily snapshots, or model pricing.',
            NodeCodeCategory.DATA,
        );
    }

    async process(context: Context): Promise<Result> {
        const target = this.getRequiredConfigValue('target') as string;
        const daysStr = this.getOptionalConfigValue('days', '30') as string;
        const days = parseInt(daysStr, 10) || 30;
        const contextPath = this.getOptionalConfigValue('context_path', 'analytics') as string;

        if (!VALID_TARGETS.includes(target as AnalyticsTarget)) {
            return this.result(ResultStatus.ERROR, `Unknown analytics target: "${target}". Valid: ${VALID_TARGETS.join(', ')}`);
        }

        try {
            const service = getAnalyticsService();
            let data: unknown;

            switch (target as AnalyticsTarget) {
                case 'today':   data = await service.getToday(); break;
                case 'summary': data = await service.getSummary(days); break;
                case 'days':    data = await service.getDays(days); break;
                case 'pricing': data = service.getModelPricing(); break;
            }

            context.set(contextPath, data);
            return this.result(ResultStatus.OK, `${contextPath} loaded (target: ${target})`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.result(ResultStatus.ERROR, `Analytics failed for "${target}": ${message}`);
        }
    }
}
