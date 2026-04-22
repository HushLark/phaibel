// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Query Token Usage NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { getAllUsage, getModelUsage, getDailyTotals, getTrackedModels } from '../../../llm/token-usage.js';
export class QueryTokenUsageNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'model', name: 'Model', description: 'Model name to query, or "all" for aggregate totals.', type: 'string', default: 'all' },
        { key: 'days', name: 'Days', description: 'Number of days to query (max 30).', type: 'string', default: '30' },
        { key: 'context_path', name: 'Context Path', description: 'Where to store results in context.', type: 'string', default: 'token_usage' },
    ];
    constructor() {
        super('query_token_usage', 'Query Token Usage', 'Queries LLM token usage by model or all models over the last N days.', NodeCodeCategory.DATA);
    }
    async process(context) {
        const model = this.getRequiredConfigValue('model', 'all');
        const days = Math.min(30, parseInt(this.getRequiredConfigValue('days', '30'), 10) || 30);
        const contextPath = this.getRequiredConfigValue('context_path', 'token_usage');
        try {
            let usage;
            if (model === 'all') {
                usage = await getDailyTotals(days);
            }
            else {
                usage = await getModelUsage(model, days);
            }
            const models = await getTrackedModels();
            const allUsage = await getAllUsage(days);
            context.set(contextPath, usage);
            context.set('tracked_models', models);
            context.set('all_usage_by_model', allUsage);
            const totalTokens = usage.reduce((sum, u) => sum + u.totalTokens, 0);
            const totalCalls = usage.reduce((sum, u) => sum + u.calls, 0);
            return this.result(ResultStatus.OK, `Queried ${days} days of usage for ${model}: ${totalTokens.toLocaleString()} tokens across ${totalCalls} calls.`);
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            context.set('error', msg);
            return this.result(ResultStatus.ERROR, `Failed to query usage: ${msg}`);
        }
    }
}
