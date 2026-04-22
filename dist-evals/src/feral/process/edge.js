// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Edge + EdgeCollection
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Indexed collection of edges for fast lookup by [fromKey][result].
 */
export class EdgeCollection {
    collection = new Map();
    addEdge(edge) {
        if (!this.collection.has(edge.fromKey)) {
            this.collection.set(edge.fromKey, new Map());
        }
        const resultMap = this.collection.get(edge.fromKey);
        if (!resultMap.has(edge.result)) {
            resultMap.set(edge.result, []);
        }
        resultMap.get(edge.result).push(edge);
    }
    getEdgesByNodeAndResult(fromKey, result) {
        return this.collection.get(fromKey)?.get(result) ?? [];
    }
    getAllEdges() {
        const all = [];
        for (const resultMap of this.collection.values()) {
            for (const edges of resultMap.values()) {
                all.push(...edges);
            }
        }
        return all;
    }
}
