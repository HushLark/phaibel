// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Analytics Catalog Source
// ─────────────────────────────────────────────────────────────────────────────
//
// Pre-configured CatalogNodes for analytics queries.
// Each node binds the `analytics` NodeCode with a specific target.
// ─────────────────────────────────────────────────────────────────────────────

import type { CatalogNode } from './catalog-node.js';

interface AnalyticsEntry {
    key: string;
    name: string;
    description: string;
    target: string;
    contextPath: string;
}

const ANALYTICS_NODES: AnalyticsEntry[] = [
    {
        key: 'get_analytics_today',
        name: 'Get Today\'s Analytics',
        description: 'Gets today\'s usage snapshot — chats, tokens, estimated cost, entity counts.',
        target: 'today',
        contextPath: 'analytics_today',
    },
    {
        key: 'get_analytics_summary',
        name: 'Get Analytics Summary',
        description: 'Gets aggregated usage summary over the last 30 days — totals, averages, costs, entity growth.',
        target: 'summary',
        contextPath: 'analytics_summary',
    },
    {
        key: 'get_analytics_daily',
        name: 'Get Daily Analytics',
        description: 'Gets daily usage snapshots over the last 30 days for trend analysis.',
        target: 'days',
        contextPath: 'analytics_daily',
    },
    {
        key: 'get_model_pricing',
        name: 'Get Model Pricing',
        description: 'Gets the cost-per-million-tokens pricing table for all supported LLM models.',
        target: 'pricing',
        contextPath: 'model_pricing',
    },
];

export class AnalyticsCatalogSource {
    getCatalogNodes(): CatalogNode[] {
        return ANALYTICS_NODES.map(entry => ({
            key: entry.key,
            nodeCodeKey: 'analytics',
            name: entry.name,
            group: 'analytics',
            description: entry.description,
            configuration: {
                target: entry.target,
                context_path: entry.contextPath,
            },
        }));
    }
}
