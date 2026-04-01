// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Chart Token Usage NodeCode
//
// Reads token usage data from context and produces an SVG bar chart.
// The chart is stored in context as HTML that the web client renders inline.
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import type { UsageSummary } from '../../../llm/token-usage.js';

export class ChartTokenUsageNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'context_path', name: 'Context Path', description: 'Context key holding the UsageSummary[] data.', type: 'string', default: 'token_usage' },
        { key: 'chart_output', name: 'Chart Output', description: 'Context key to store the rendered chart HTML.', type: 'string', default: 'chart_html' },
        { key: 'title', name: 'Title', description: 'Chart title.', type: 'string', default: 'Token Usage' },
    ];

    constructor() {
        super(
            'chart_token_usage',
            'Chart Token Usage',
            'Renders a bar chart of token usage data as inline SVG.',
            NodeCodeCategory.DATA,
        );
    }

    async process(context: Context): Promise<Result> {
        const contextPath = this.getRequiredConfigValue('context_path', 'token_usage') as string;
        const chartOutput = this.getRequiredConfigValue('chart_output', 'chart_html') as string;
        const title = this.getRequiredConfigValue('title', 'Token Usage') as string;

        const usage = context.get(contextPath) as UsageSummary[] | undefined;
        if (!usage || usage.length === 0) {
            const emptyMsg = `<p style="color:#888;font-style:italic;">No token usage data available yet.</p>`;
            context.set(chartOutput, emptyMsg);
            return this.result(ResultStatus.OK, 'No usage data to chart.');
        }

        // Also check for per-model breakdown
        const allByModel = context.get('all_usage_by_model') as UsageSummary[] | undefined;

        const chart = this.renderChart(usage, allByModel || [], title);
        context.set(chartOutput, chart);

        return this.result(ResultStatus.OK, `Chart rendered with ${usage.length} data points.`);
    }

    private renderChart(dailyTotals: UsageSummary[], allByModel: UsageSummary[], title: string): string {
        // Build daily totals bar chart
        const W = 600;
        const H = 280;
        const PAD_LEFT = 60;
        const PAD_RIGHT = 20;
        const PAD_TOP = 40;
        const PAD_BOTTOM = 60;
        const chartW = W - PAD_LEFT - PAD_RIGHT;
        const chartH = H - PAD_TOP - PAD_BOTTOM;

        const maxTokens = Math.max(...dailyTotals.map(d => d.totalTokens), 1);
        const barCount = dailyTotals.length;
        const barGap = 2;
        const barW = Math.max(4, (chartW - barGap * barCount) / barCount);

        // Color palette for models
        const MODEL_COLORS: Record<string, string> = {};
        const PALETTE = ['#6366f1', '#f59e0b', '#10b981', '#f43f5e', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];
        const models = [...new Set(allByModel.map(u => u.model))].sort();
        models.forEach((m, i) => { MODEL_COLORS[m] = PALETTE[i % PALETTE.length]; });

        // Build per-day per-model stacks
        const dayMap = new Map<string, Map<string, number>>();
        for (const entry of allByModel) {
            if (!dayMap.has(entry.date)) dayMap.set(entry.date, new Map());
            const existing = dayMap.get(entry.date)!.get(entry.model) || 0;
            dayMap.get(entry.date)!.set(entry.model, existing + entry.totalTokens);
        }

        let bars = '';
        for (let i = 0; i < barCount; i++) {
            const d = dailyTotals[i];
            const x = PAD_LEFT + i * (barW + barGap);
            const modelBreakdown = dayMap.get(d.date);

            if (modelBreakdown && models.length > 1) {
                // Stacked bar
                let yOffset = 0;
                for (const model of models) {
                    const tokens = modelBreakdown.get(model) || 0;
                    const segH = (tokens / maxTokens) * chartH;
                    const y = PAD_TOP + chartH - yOffset - segH;
                    bars += `<rect x="${x}" y="${y}" width="${barW}" height="${segH}" fill="${MODEL_COLORS[model]}" rx="1">` +
                        `<title>${d.date}\n${model}: ${tokens.toLocaleString()} tokens</title></rect>`;
                    yOffset += segH;
                }
            } else {
                // Single bar
                const barH = (d.totalTokens / maxTokens) * chartH;
                const y = PAD_TOP + chartH - barH;
                bars += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="#6366f1" rx="1">` +
                    `<title>${d.date}: ${d.totalTokens.toLocaleString()} tokens (${d.calls} calls)</title></rect>`;
            }

            // X-axis labels (every few bars to avoid crowding)
            const labelInterval = Math.max(1, Math.floor(barCount / 7));
            if (i % labelInterval === 0 || i === barCount - 1) {
                const label = d.date.slice(5); // MM-DD
                bars += `<text x="${x + barW / 2}" y="${H - PAD_BOTTOM + 16}" text-anchor="middle" ` +
                    `fill="#888" font-size="10" font-family="sans-serif">${label}</text>`;
            }
        }

        // Y-axis labels
        const ySteps = 4;
        let yLabels = '';
        for (let i = 0; i <= ySteps; i++) {
            const val = Math.round((maxTokens / ySteps) * i);
            const y = PAD_TOP + chartH - (i / ySteps) * chartH;
            const label = val >= 1000000 ? (val / 1000000).toFixed(1) + 'M'
                : val >= 1000 ? (val / 1000).toFixed(0) + 'k'
                    : String(val);
            yLabels += `<text x="${PAD_LEFT - 8}" y="${y + 4}" text-anchor="end" fill="#888" font-size="10" font-family="sans-serif">${label}</text>`;
            yLabels += `<line x1="${PAD_LEFT}" y1="${y}" x2="${W - PAD_RIGHT}" y2="${y}" stroke="#333" stroke-width="0.5"/>`;
        }

        // Legend (if multiple models)
        let legend = '';
        if (models.length > 1) {
            const legendY = H - 10;
            let legendX = PAD_LEFT;
            for (const model of models) {
                legend += `<rect x="${legendX}" y="${legendY - 8}" width="10" height="10" fill="${MODEL_COLORS[model]}" rx="2"/>`;
                legend += `<text x="${legendX + 14}" y="${legendY}" fill="#ccc" font-size="10" font-family="sans-serif">${model}</text>`;
                legendX += 14 + model.length * 6 + 16;
            }
        }

        // Summary stats
        const totalTokens = dailyTotals.reduce((s, d) => s + d.totalTokens, 0);
        const totalCalls = dailyTotals.reduce((s, d) => s + d.calls, 0);
        const avgPerDay = Math.round(totalTokens / (barCount || 1));

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H + (models.length > 1 ? 20 : 0)}" ` +
            `style="width:100%;max-width:${W}px;background:#111;border-radius:8px;padding:4px;">` +
            `<text x="${W / 2}" y="24" text-anchor="middle" fill="#e8e8ef" font-size="14" font-weight="600" font-family="sans-serif">${title}</text>` +
            yLabels + bars + legend +
            `</svg>`;

        const stats = `**${totalTokens.toLocaleString()}** total tokens | **${totalCalls.toLocaleString()}** API calls | **${avgPerDay.toLocaleString()}** avg/day`;

        return svg + '\n\n' + stats;
    }
}
