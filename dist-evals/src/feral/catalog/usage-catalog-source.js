// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Usage Catalog Source
//
// Pre-configured CatalogNodes for querying and charting LLM token usage.
// Generates a "query all" node plus per-model query nodes dynamically.
// ─────────────────────────────────────────────────────────────────────────────
export class UsageCatalogSource {
    models;
    constructor(models) {
        this.models = models;
    }
    getCatalogNodes() {
        const nodes = [
            // Query all models (aggregate daily totals)
            {
                key: 'query_all_token_usage',
                nodeCodeKey: 'query_token_usage',
                name: 'Query All Token Usage',
                group: 'data',
                description: 'Queries total LLM token usage across all models for the last 30 days. Stores daily totals in context.',
                configuration: { model: 'all', days: '30', context_path: 'token_usage' },
            },
            // Chart token usage (reads from context after a query node)
            {
                key: 'chart_all_token_usage',
                nodeCodeKey: 'chart_token_usage',
                name: 'Chart Token Usage',
                group: 'data',
                description: 'Renders an SVG bar chart of token usage data. Must run after a query_token_usage node. Outputs chart HTML to context.',
                configuration: { context_path: 'token_usage', chart_output: 'chart_html', title: 'Token Usage (Last 30 Days)' },
            },
        ];
        // Per-model query nodes
        for (const model of this.models) {
            const safeKey = model.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            nodes.push({
                key: `query_${safeKey}_usage`,
                nodeCodeKey: 'query_token_usage',
                name: `Query ${model} Usage`,
                group: 'data',
                description: `Queries token usage for model "${model}" over the last 30 days.`,
                configuration: { model, days: '30', context_path: 'token_usage' },
            });
        }
        return nodes;
    }
}
