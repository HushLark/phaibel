// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Catalog
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Registry of all available CatalogNodes, populated from CatalogSource providers.
 */
export class Catalog {
    nodes = new Map();
    constructor(sources = []) {
        for (const source of sources) {
            for (const node of source.getCatalogNodes()) {
                if (node.key)
                    this.nodes.set(node.key, node);
            }
        }
    }
    getCatalogNode(key) {
        const node = this.nodes.get(key);
        if (!node)
            throw new Error(`Catalog node "${key}" not found.`);
        return node;
    }
    getAllCatalogNodes() {
        return Array.from(this.nodes.values());
    }
}
