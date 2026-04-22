// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — NodeCode Factory
// ─────────────────────────────────────────────────────────────────────────────
import { InvalidNodeCodeKeyError } from '../errors.js';
/**
 * Registry of all available NodeCode instances.
 * Populated from NodeCodeSource providers at construction time.
 */
export class NodeCodeFactory {
    registry = new Map();
    constructor(sources = []) {
        for (const source of sources) {
            for (const nc of source.getNodeCodes()) {
                if (nc.key)
                    this.registry.set(nc.key, nc);
            }
        }
    }
    getNodeCode(key) {
        const nc = this.registry.get(key);
        if (!nc)
            throw new InvalidNodeCodeKeyError(key);
        return nc;
    }
    register(nodeCode) {
        this.registry.set(nodeCode.key, nodeCode);
    }
    getAllNodeCodes() {
        return Array.from(this.registry.values());
    }
}
