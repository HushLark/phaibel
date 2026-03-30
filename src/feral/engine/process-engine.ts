// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Process Engine
// ─────────────────────────────────────────────────────────────────────────────

import type { EventDispatcher } from '../events/event-dispatcher.js';
import type { Catalog } from '../catalog/catalog.js';
import type { NodeCodeFactory } from '../node-code/node-code-factory.js';
import type { NodeCode } from '../node-code/node-code.js';
import type { ConfigurationDescription } from '../configuration/configuration-description.js';
import { type ConfigurationValue, ConfigurationValueType } from '../configuration/configuration-value.js';
import type { Context } from '../context/context.js';
import type { Result } from '../result/result.js';
import { ResultStatus } from '../result/result.js';
import { EdgeCollection } from '../process/edge.js';
import type { Process } from '../process/process.js';
import type { ProcessNode } from '../process/node.js';
import { InvalidNodeKeyError } from '../errors.js';

/**
 * Core execution loop.
 *
 * Resolves NodeCode from CatalogNode references, layers configuration
 * (NodeCode defaults → CatalogNode config → ProcessNode config),
 * and runs the directed node graph sequentially.
 */
export class ProcessEngine {
    private cachedNodeCodes: Map<string, NodeCode> = new Map();

    constructor(
        private eventDispatcher: EventDispatcher,
        private catalog: Catalog,
        private nodeCodeFactory: NodeCodeFactory,
    ) { }

    /**
     * Clear the node code cache. Call before re-running a process with the same
     * node keys but different catalog_node_key mappings (e.g. chat iterations).
     */
    clearCache(): void {
        this.cachedNodeCodes.clear();
    }

    async process(processDefn: Process, context: Context, startNodeKey = 'start'): Promise<void> {
        const nodeMap = new Map(processDefn.nodes.map(n => [n.key, n]));
        const edgeCollection = new EdgeCollection();
        for (const edge of processDefn.edges) {
            edgeCollection.addEdge(edge);
        }

        // Merge process context into runtime context
        for (const [k, v] of Object.entries(processDefn.context.getAll())) {
            context.set(k, v);
        }

        this.eventDispatcher.dispatch({ type: 'process.start', process: processDefn, context });

        let currentKey = startNodeKey;
        let node = nodeMap.get(currentKey);
        if (!node) throw new InvalidNodeKeyError(currentKey);

        let nodeCode = this.getConfiguredNodeCode(node);
        let result = await this.processNode(node, nodeCode, context);

        while (result.status !== ResultStatus.STOP) {
            const edges = edgeCollection.getEdgesByNodeAndResult(currentKey, result.status);
            if (edges.length === 0) {
                throw new Error(`No edge found for node "${currentKey}" with result "${result.status}".`);
            }

            currentKey = edges[0].toKey;
            node = nodeMap.get(currentKey);
            if (!node) throw new InvalidNodeKeyError(currentKey);

            nodeCode = this.getConfiguredNodeCode(node);
            result = await this.processNode(node, nodeCode, context);
        }

        this.eventDispatcher.dispatch({ type: 'process.end', process: processDefn, context });
    }

    private getConfiguredNodeCode(node: ProcessNode): NodeCode {
        if (this.cachedNodeCodes.has(node.key)) {
            return this.cachedNodeCodes.get(node.key)!;
        }

        const catalogNode = this.catalog.getCatalogNode(node.catalogNodeKey);
        const nodeCode = this.nodeCodeFactory.getNodeCode(catalogNode.nodeCodeKey);

        // Get config descriptions from the NodeCode class
        const Ctor = nodeCode.constructor as { configDescriptions?: ConfigurationDescription[] };
        const descriptions: ConfigurationDescription[] = Ctor.configDescriptions ?? [];

        // Build ConfigurationValue objects from descriptions
        const configValues: Map<string, ConfigurationValue> = new Map();
        const requiredKeys = new Set<string>();

        for (const desc of descriptions) {
            const type = desc.isSecret
                ? (desc.isOptional ? ConfigurationValueType.OPTIONAL_SECRET : ConfigurationValueType.SECRET)
                : (desc.isOptional ? ConfigurationValueType.OPTIONAL : ConfigurationValueType.STANDARD);
            const cv: ConfigurationValue = { key: desc.key, type, default: desc.default };
            configValues.set(desc.key, cv);
            if (!desc.isOptional && desc.default == null) {
                requiredKeys.add(desc.key);
            }
        }

        // Validate keys from catalog & process config (unless node allows extras)
        const validKeys = new Set(configValues.keys());
        if (!nodeCode.allowExtraConfig) {
            for (const k of Object.keys(catalogNode.configuration)) {
                if (!validKeys.has(k)) {
                    throw new Error(`Catalog config key "${k}" invalid for node "${catalogNode.key}". Valid: ${[...validKeys].join(', ')}`);
                }
            }
            for (const k of Object.keys(node.configuration)) {
                if (!validKeys.has(k)) {
                    throw new Error(`Process config key "${k}" invalid for node "${node.key}". Valid: ${[...validKeys].join(', ')}`);
                }
            }
        }

        // Merge: catalog config, then process node config overrides
        const merged = { ...catalogNode.configuration, ...node.configuration };
        for (const [k, v] of Object.entries(merged)) {
            let cv = configValues.get(k);
            if (!cv) {
                // Extra key allowed by allowExtraConfig — create an OPTIONAL entry
                cv = { key: k, type: ConfigurationValueType.OPTIONAL };
                configValues.set(k, cv);
            }
            configValues.set(k, { ...cv, value: v });
            requiredKeys.delete(k);
        }

        // Remove required keys that have defaults
        for (const [k, cv] of configValues) {
            if (cv.default != null) requiredKeys.delete(k);
        }

        if (requiredKeys.size > 0) {
            throw new Error(`Missing required config: ${[...requiredKeys].join(', ')} for node "${node.key}".`);
        }

        nodeCode.addConfiguration(Array.from(configValues.values()));
        this.cachedNodeCodes.set(node.key, nodeCode);
        return nodeCode;
    }

    private async processNode(node: ProcessNode, nodeCode: NodeCode, context: Context): Promise<Result> {
        this.eventDispatcher.dispatch({ type: 'process.node.before', node, context });

        try {
            const result = await nodeCode.process(context);
            this.eventDispatcher.dispatch({ type: 'process.node.after', node, context, result });
            return result;
        } catch (error) {
            this.eventDispatcher.dispatch({
                type: 'process.exception',
                nodeCode,
                context,
                error: error instanceof Error ? error : new Error(String(error)),
            });
            throw error;
        }
    }
}
