// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — List Catalog Nodes NodeCode
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import type { Catalog } from '../../catalog/catalog.js';

export class ListCatalogNodesNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'context_path', name: 'Context Path', description: 'Context key to store the grouped catalog nodes.', type: 'string', isOptional: true, default: 'catalog_nodes' },
        { key: 'group', name: 'Group Filter', description: 'Filter catalog nodes by group name.', type: 'string', isOptional: true },
    ];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: 'ok', description: 'Catalog nodes listed successfully.' },
    ];
    private catalog: Catalog;

    constructor(catalog: Catalog) {
        super(
            'list_catalog_nodes',
            'List Catalog Nodes',
            'Lists all available catalog nodes (capabilities) grouped by category.',
            NodeCodeCategory.DATA,
        );
        this.catalog = catalog;
    }

    async process(context: Context): Promise<Result> {
        const contextPath = this.getOptionalConfigValue('context_path', 'catalog_nodes') as string;
        const groupFilter = this.getOptionalConfigValue('group') as string | null;

        let nodes = this.catalog.getAllCatalogNodes();
        if (groupFilter) {
            nodes = nodes.filter(n => n.group === groupFilter);
        }

        const grouped: Record<string, { key: string; description: string }[]> = {};
        for (const node of nodes) {
            const group = node.group || 'ungrouped';
            if (!grouped[group]) grouped[group] = [];
            grouped[group].push({ key: node.key, description: node.description });
        }

        context.set(contextPath, grouped);
        const totalCount = nodes.length;
        const groupCount = Object.keys(grouped).length;
        return this.result(ResultStatus.OK, `Found ${totalCount} catalog node(s) in ${groupCount} group(s).`);
    }
}
