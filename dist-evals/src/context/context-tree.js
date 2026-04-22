// ─────────────────────────────────────────────────────────────────────────────
// Context Tree — Hierarchical vault context for LLM consumption
//
// Models the vault as: Trunk (root) → Branches (entity types) → Leaves (entities)
// with Edges connecting leaves across types. Scope controls which parts
// of the tree are materialized to stay within token budgets.
// ─────────────────────────────────────────────────────────────────────────────
import { getPlatform } from '../platform/index.js';
import { getVaultContext, getSubdirectoryContext } from './reader.js';
import { getEntityIndex } from '../entities/entity-index.js';
import { loadEntityTypes } from '../entities/entity-type-config.js';
import { parseEntity } from '../entities/entity.js';
import { debug } from '../utils/debug.js';
// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const MAX_LEAVES_PER_BRANCH = 50;
const MAX_FULL_CONTENT_LEAVES = 50;
// ─────────────────────────────────────────────────────────────────────────────
// BUILDER
// ─────────────────────────────────────────────────────────────────────────────
function fieldToTreeField(f) {
    const tf = { key: f.key, type: f.type };
    if (f.type === 'enum' && f.values)
        tf.values = f.values;
    return tf;
}
function indexNodeToLeaf(node, includeContent) {
    return {
        key: `${node.type}:${node.id}`,
        title: node.title,
        tags: node.tags,
        summary: node.summary,
        meta: node.meta,
        content: includeContent,
    };
}
/**
 * Build the context tree trunk — always included.
 */
async function buildTrunk(globals) {
    const vaultContext = await getVaultContext().catch(() => '');
    const index = getEntityIndex();
    const stats = index.getStats();
    return {
        vaultContext,
        globals,
        stats: {
            totalEntities: stats.nodeCount,
            entityTypes: Object.keys(stats.byType),
        },
    };
}
/**
 * Build a branch (entity type) with optional leaf population.
 */
async function buildBranch(typeConfig, leafMode) {
    const index = getEntityIndex();
    const subdirContext = await getSubdirectoryContext(typeConfig.directory).catch(() => '');
    const nodes = index.getNodes(typeConfig.name);
    let leaves = [];
    if (leafMode === 'summary') {
        // Sort by recency (meta.created descending), cap at MAX_LEAVES_PER_BRANCH
        const sorted = [...nodes].sort((a, b) => {
            const aDate = a.meta.created || '';
            const bDate = b.meta.created || '';
            return bDate.localeCompare(aDate);
        });
        leaves = sorted.slice(0, MAX_LEAVES_PER_BRANCH).map(n => indexNodeToLeaf(n));
    }
    else if (leafMode === 'full') {
        // Load full content from disk, capped
        const sorted = [...nodes].sort((a, b) => {
            const aDate = a.meta.created || '';
            const bDate = b.meta.created || '';
            return bDate.localeCompare(aDate);
        });
        const toLoad = sorted.slice(0, MAX_FULL_CONTENT_LEAVES);
        leaves = await Promise.all(toLoad.map(async (n) => {
            try {
                const raw = await getPlatform().storage.readFile(n.filepath);
                const { content } = parseEntity(n.filepath, raw);
                return indexNodeToLeaf(n, content);
            }
            catch {
                return indexNodeToLeaf(n);
            }
        }));
    }
    return {
        entityType: typeConfig.name,
        plural: typeConfig.plural,
        description: typeConfig.description || '',
        fields: typeConfig.fields.map(fieldToTreeField),
        subdirectoryContext: subdirContext,
        leafCount: nodes.length,
        leaves,
    };
}
/**
 * Filter edges to only include those connecting included leaves.
 */
function filterEdges(allEdges, includedKeys) {
    return allEdges
        .filter(e => includedKeys.has(e.source) && includedKeys.has(e.target))
        .map(e => ({
        source: e.source,
        target: e.target,
        edgeType: e.edgeType,
        label: e.label,
    }));
}
/**
 * Build the full context tree based on scope.
 */
export async function buildContextTree(scope, globals) {
    const entityTypes = await loadEntityTypes();
    const entityTypeMap = new Map(entityTypes.map(t => [t.name, t]));
    const index = getEntityIndex();
    // 1. Always build trunk
    const trunk = await buildTrunk(globals);
    // 2. Build branches based on scope
    let branches = [];
    const includedLeafKeys = new Set();
    switch (scope.type) {
        case 'trunk': {
            // All branches with metadata only (no leaves)
            branches = await Promise.all(entityTypes.map(t => buildBranch(t, 'none')));
            break;
        }
        case 'branch': {
            // Requested branches get leaf summaries; others get none
            branches = await Promise.all(entityTypes.map(t => buildBranch(t, scope.branches.includes(t.name) ? 'summary' : 'none')));
            break;
        }
        case 'branch-full': {
            // Requested branches get full content; others get none
            branches = await Promise.all(entityTypes.map(t => buildBranch(t, scope.branches.includes(t.name) ? 'full' : 'none')));
            break;
        }
        case 'leaves': {
            // Specific leaves + their branches
            const leafTypes = new Set();
            for (const key of scope.keys) {
                const node = index.getNode(key);
                if (node)
                    leafTypes.add(node.type);
            }
            // Build branches: types with requested leaves get summary, others none
            branches = await Promise.all(entityTypes.map(t => buildBranch(t, leafTypes.has(t.name) ? 'summary' : 'none')));
            break;
        }
        case 'cross': {
            // Requested branches get summaries
            branches = await Promise.all(entityTypes.map(t => buildBranch(t, scope.branches.includes(t.name) ? 'summary' : 'none')));
            break;
        }
    }
    // Collect all included leaf keys for edge filtering
    for (const branch of branches) {
        for (const leaf of branch.leaves) {
            includedLeafKeys.add(leaf.key);
        }
    }
    // 3. Filter edges to only those connecting included leaves
    const edges = filterEdges(index.getAllEdges(), includedLeafKeys);
    debug('context-tree', `Built tree: scope=${scope.type}, branches=${branches.length}, leaves=${includedLeafKeys.size}, edges=${edges.length}`);
    return { trunk, branches, edges };
}
/**
 * Expand an existing context tree with additional branches (adds leaf summaries).
 * Mutates the tree in place and returns it.
 */
export async function expandContextTree(tree, additionalBranches) {
    const entityTypes = await loadEntityTypes();
    const existingTypes = new Set(tree.branches.map(b => b.entityType));
    for (const typeName of additionalBranches) {
        if (existingTypes.has(typeName)) {
            // Already present — upgrade from 'none' to 'summary' if needed
            const existing = tree.branches.find(b => b.entityType === typeName);
            if (existing.leaves.length === 0 && existing.leafCount > 0) {
                const typeConfig = entityTypes.find(t => t.name === typeName);
                if (typeConfig) {
                    const upgraded = await buildBranch(typeConfig, 'summary');
                    Object.assign(existing, upgraded);
                }
            }
            continue;
        }
        const typeConfig = entityTypes.find(t => t.name === typeName);
        if (typeConfig) {
            const branch = await buildBranch(typeConfig, 'summary');
            tree.branches.push(branch);
        }
    }
    // Rebuild included leaf keys and re-filter edges
    const includedLeafKeys = new Set();
    for (const branch of tree.branches) {
        for (const leaf of branch.leaves) {
            includedLeafKeys.add(leaf.key);
        }
    }
    const index = getEntityIndex();
    tree.edges = filterEdges(index.getAllEdges(), includedLeafKeys);
    return tree;
}
