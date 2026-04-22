// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Built-In Catalog Source
// ─────────────────────────────────────────────────────────────────────────────
import { createCatalogNode } from './catalog-node.js';
/**
 * Automatically creates a 1:1 CatalogNode for every registered NodeCode.
 * This ensures all built-in node codes are available in the catalog
 * without requiring any configuration.
 */
export class BuiltInCatalogSource {
    nodeCodeFactory;
    constructor(nodeCodeFactory) {
        this.nodeCodeFactory = nodeCodeFactory;
    }
    getCatalogNodes() {
        return this.nodeCodeFactory.getAllNodeCodes().map(nc => createCatalogNode({
            key: nc.key,
            nodeCodeKey: nc.key,
            name: nc.name,
            group: nc.categoryKey,
            description: nc.description,
        }));
    }
}
