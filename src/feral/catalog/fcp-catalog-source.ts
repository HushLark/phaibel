// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — FCP Catalog Source
//
// Registers catalog nodes for federated content probing and fetching.
// Only active when FCP sources are configured.
// ─────────────────────────────────────────────────────────────────────────────

import type { CatalogNode } from './catalog-node.js';
import type { CatalogSource } from './catalog.js';

export class FcpCatalogSource implements CatalogSource {
    getCatalogNodes(): CatalogNode[] {
        return [
            {
                key: 'fcp_probe_keywords',
                nodeCodeKey: 'fcp_probe',
                name: 'FCP Probe — Keywords',
                group: 'federation',
                description: 'Search all configured federated content sources by keyword. Extracts keywords from user_input automatically. Returns titles and IDs — follow with fcp_fetch to retrieve full content.',
                configuration: { mode: 'keyword' },
            },
            {
                key: 'fcp_probe_date',
                nodeCodeKey: 'fcp_probe',
                name: 'FCP Probe — By Date',
                group: 'federation',
                description: 'Ask all federated sources what they have for a specific date. Uses context "date" key or today\'s date. Follow with fcp_fetch for full content.',
                configuration: { mode: 'date' },
            },
            {
                key: 'fcp_probe_todos',
                nodeCodeKey: 'fcp_probe',
                name: 'FCP Probe — Open Todos',
                group: 'federation',
                description: 'Ask all federated sources for open tasks and action items. Follow with fcp_fetch for full content.',
                configuration: { mode: 'todo' },
            },
            {
                key: 'fcp_probe_latest',
                nodeCodeKey: 'fcp_probe',
                name: 'FCP Probe — Latest',
                group: 'federation',
                description: 'Ask all federated sources for their most recently created or updated items. Follow with fcp_fetch for full content.',
                configuration: { mode: 'latest' },
            },
            {
                key: 'fcp_fetch',
                nodeCodeKey: 'fcp_fetch',
                name: 'FCP Fetch',
                group: 'federation',
                description: 'Fetch full content from federated sources using IDs from a prior fcp_probe result. Stores nodes in fcp_nodes context key. Must be preceded by an fcp_probe_* node.',
                configuration: { probe_context_path: 'fcp_probe', context_path: 'fcp_nodes' },
            },
            {
                key: 'fcp_fetch_summary',
                nodeCodeKey: 'fcp_fetch',
                name: 'FCP Fetch — Summary Only',
                group: 'federation',
                description: 'Fetch summary-level content (no full bodies) from federated sources. Token-efficient. Must be preceded by an fcp_probe_* node.',
                configuration: { probe_context_path: 'fcp_probe', detail: 'summary', context_path: 'fcp_nodes' },
            },
        ];
    }
}
