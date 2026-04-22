// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — JSON Catalog Source
// ─────────────────────────────────────────────────────────────────────────────
import { createCatalogNode } from './catalog-node.js';
/**
 * Creates CatalogNodes from user-defined JSON configuration.
 * These are preconfigured specializations — e.g. an "http" NodeCode
 * wrapped as "fetch_user_api" with a preset URL and method.
 */
export class JsonCatalogSource {
    config;
    constructor(config) {
        this.config = config;
    }
    getCatalogNodes() {
        return this.config.catalog_nodes.map(entry => createCatalogNode({
            key: entry.key,
            nodeCodeKey: entry.node_code_key,
            name: entry.name,
            group: entry.group,
            description: entry.description,
            configuration: entry.configuration,
        }));
    }
}
