// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — NodeCode Factory
// ─────────────────────────────────────────────────────────────────────────────

import { InvalidNodeCodeKeyError } from '../errors.js';
import type { NodeCode } from './node-code.js';

/**
 * A source that provides NodeCode instances.
 * Multiple sources can be composed into a single factory.
 */
export interface NodeCodeSource {
    getNodeCodes(): NodeCode[];
}

/**
 * Registry of all available NodeCode instances.
 * Populated from NodeCodeSource providers at construction time.
 */
export class NodeCodeFactory {
    private registry: Map<string, NodeCode> = new Map();

    constructor(sources: NodeCodeSource[] = []) {
        for (const source of sources) {
            for (const nc of source.getNodeCodes()) {
                if (nc.key) this.registry.set(nc.key, nc);
            }
        }
    }

    getNodeCode(key: string): NodeCode {
        const nc = this.registry.get(key);
        if (!nc) throw new InvalidNodeCodeKeyError(key);
        return nc;
    }

    register(nodeCode: NodeCode): void {
        this.registry.set(nodeCode.key, nodeCode);
    }

    getAllNodeCodes(): NodeCode[] {
        return Array.from(this.registry.values());
    }
}
