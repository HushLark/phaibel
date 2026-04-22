// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Process JSON Hydrator
// ─────────────────────────────────────────────────────────────────────────────
import { DefaultContext } from '../context/context.js';
/**
 * Hydrates a Process from a validated JSON configuration.
 */
export function hydrateProcess(json) {
    if (json.schema_version !== 1) {
        throw new Error('Only schema version 1 is accepted.');
    }
    if (!json.key) {
        throw new Error('A key is required for a process.');
    }
    const context = new DefaultContext();
    for (const [k, v] of Object.entries(json.context ?? {})) {
        context.set(k, v);
    }
    const nodes = [];
    const edges = [];
    for (const nodeDef of json.nodes) {
        nodes.push({
            key: nodeDef.key,
            description: nodeDef.description ?? '',
            catalogNodeKey: nodeDef.catalog_node_key,
            configuration: nodeDef.configuration ?? {},
        });
        for (const [result, toKey] of Object.entries(nodeDef.edges ?? {})) {
            edges.push({ fromKey: nodeDef.key, toKey, result });
        }
    }
    return {
        key: json.key,
        description: json.description ?? '',
        tool: json.tool,
        context,
        nodes,
        edges,
    };
}
/**
 * Convenience: parse a raw JSON string into a Process.
 */
export function hydrateProcessFromString(jsonString) {
    const parsed = JSON.parse(jsonString);
    return hydrateProcess(parsed);
}
