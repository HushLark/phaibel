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
            // CRUD writeback per writable context type (when the source allows it).
            if (s.manifest?.capabilities?.writeNodes) {
                for (const t of s.manifest.context_types) {
                    if (t.readonly) continue;
                    nodes.push(createCatalogNode({
                        key: `cfx3_${s.id}_write_${t.name}`,
                        nodeCodeKey: 'cfx3_write',
                        name: `${s.name}: Create/update ${t.name}`,
                        group: `cfx3:${s.id}`,
                        description: t.description ?? `Create or update a ${t.name} in ${s.name}.`,
                        configuration: { source_id: s.id, op: 'node.create' },
                    }));
                }
            }
        }
        return nodes;
    }
}
