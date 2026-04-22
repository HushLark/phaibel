// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — List Catalog Nodes NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
export class ListCatalogNodesNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'context_path', name: 'Context Path', description: 'Context key to store the grouped catalog nodes.', type: 'string', isOptional: true, default: 'catalog_nodes' },
        { key: 'group', name: 'Group Filter', description: 'Filter catalog nodes by group name.', type: 'string', isOptional: true },
    ];
    static resultDescriptions = [
        { status: 'ok', description: 'Catalog nodes listed successfully.' },
    ];
    catalog;
    constructor(catalog) {
        super('list_catalog_nodes', 'List Catalog Nodes', 'Lists all available catalog nodes (capabilities) grouped by category.', NodeCodeCategory.DATA);
        this.catalog = catalog;
    }
    async process(context) {
        const contextPath = this.getOptionalConfigValue('context_path', 'catalog_nodes');
        const groupFilter = this.getOptionalConfigValue('group');
        let nodes = this.catalog.getAllCatalogNodes();
        if (groupFilter) {
            nodes = nodes.filter(n => n.group === groupFilter);
        }
        const grouped = {};
        for (const node of nodes) {
            const group = node.group || 'ungrouped';
            if (!grouped[group])
                grouped[group] = [];
            grouped[group].push({ key: node.key, description: node.description });
        }
        context.set(contextPath, grouped);
        const totalCount = nodes.length;
        const groupCount = Object.keys(grouped).length;
        return this.result(ResultStatus.OK, `Found ${totalCount} catalog node(s) in ${groupCount} group(s).`);
    }
}
