// ─────────────────────────────────────────────────────────────────────────────
// Feral CF/x3 — Catalog Source: exposes each configured source's sync + tools as
// selectable catalog nodes, so the process matcher / LLM can pull context and
// invoke remote actions during a chat. Mirrors A2ACatalogSource.
// ─────────────────────────────────────────────────────────────────────────────

import type { CatalogSource } from './catalog.js';
import type { CatalogNode } from './catalog-node.js';
import { createCatalogNode } from './catalog-node.js';
import type { Cfx3Source } from '../../cfx3/source-registry.js';

export class Cfx3CatalogSource implements CatalogSource {
    constructor(private sources: Cfx3Source[]) {}

    getCatalogNodes(): CatalogNode[] {
        const nodes: CatalogNode[] = [];
        for (const s of this.sources) {
            nodes.push(createCatalogNode({
                key: `cfx3_${s.id}_sync`,
                nodeCodeKey: 'cfx3_sync',
                name: `${s.name}: Sync context`,
                group: `cfx3:${s.id}`,
                description: `Pull the latest context from ${s.name} into the local store.`,
                configuration: { source_id: s.id },
            }));
            for (const tool of s.manifest?.tools ?? []) {
                nodes.push(createCatalogNode({
                    key: `cfx3_${s.id}_${tool.id.replace(/[^a-z0-9]+/gi, '_')}`,
                    nodeCodeKey: 'cfx3_act',
                    name: `${s.name}: ${tool.id}`,
                    group: `cfx3:${s.id}`,
                    description: tool.description ?? `Invoke ${tool.id} on ${s.name}.`,
                    configuration: { source_id: s.id, tool: tool.id },
                }));
            }
        }
        return nodes;
    }
}
