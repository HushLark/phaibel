// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — CLI Command
// ─────────────────────────────────────────────────────────────────────────────

import { Command } from 'commander';
import chalk from 'chalk';
import { bootstrapFeral } from '../feral/bootstrap.js';
import { getFeralCatalogPath } from '../paths.js';
import type { ConfigurationDescription, ResultDescription } from '../feral/configuration/configuration-description.js';
import type { Process } from '../feral/process/process.js';
import type { Edge } from '../feral/process/edge.js';

export const feralCommand = new Command('feral')
    .description(chalk.cyan('🔀 Feral CCF — Flow-Based Programming Engine'));

// ─────────────────────────────────────────────────────────────────────────────
// feral nodes [key] — list all registered NodeCodes, or show detail
// ─────────────────────────────────────────────────────────────────────────────
feralCommand
    .command('nodes [key]')
    .description('List all available NodeCodes, or show detail for a specific one')
    .action(async (key?: string) => {
        const runtime = await bootstrapFeral();

        if (key) {
            // Show detail for a single NodeCode
            try {
                const nc = runtime.nodeCodeFactory.getNodeCode(key);
                console.log(chalk.cyan(`\n🔀 NodeCode: ${chalk.bold(nc.key)}\n`));
                console.log(`  ${chalk.gray('Name:')}        ${nc.name}`);
                console.log(`  ${chalk.gray('Category:')}    ${nc.categoryKey}`);
                console.log(`  ${chalk.gray('Description:')} ${nc.description}`);

                // Config descriptions
                const Ctor = nc.constructor as {
                    configDescriptions?: ConfigurationDescription[];
                    resultDescriptions?: ResultDescription[];
                };
                const configs = Ctor.configDescriptions ?? [];
                if (configs.length > 0) {
                    console.log(`\n  ${chalk.yellow('Configuration Keys:')}`);
                    for (const desc of configs) {
                        const optional = desc.isOptional ? chalk.gray(' (optional)') : chalk.red(' (required)');
                        const defaultVal = desc.default != null ? chalk.gray(` [default: ${desc.default}]`) : '';
                        console.log(`    ${chalk.bold(desc.key)}${optional}${defaultVal}`);
                        console.log(chalk.gray(`      ${desc.description}`));
                        if (desc.options) {
                            console.log(chalk.gray(`      options: ${desc.options.join(', ')}`));
                        }
                    }
                }

                // Result descriptions
                const results = Ctor.resultDescriptions ?? [];
                if (results.length > 0) {
                    console.log(`\n  ${chalk.yellow('Result Statuses:')}`);
                    for (const r of results) {
                        console.log(`    ${chalk.bold(r.status)}  ${chalk.gray(r.description)}`);
                    }
                }

                console.log('');
            } catch {
                console.log(chalk.red(`\n  NodeCode "${key}" not found.\n`));
                console.log(chalk.gray('  Run `phaibel feral nodes` to see all available NodeCodes.\n'));
            }
        } else {
            // List all NodeCodes
            const nodeCodes = runtime.nodeCodeFactory.getAllNodeCodes();
            console.log(chalk.cyan('\n🔀 Feral NodeCodes\n'));

            // Group by category
            const grouped = new Map<string, typeof nodeCodes>();
            for (const nc of nodeCodes) {
                const cat = nc.categoryKey || 'Uncategorized';
                if (!grouped.has(cat)) grouped.set(cat, []);
                grouped.get(cat)!.push(nc);
            }

            for (const [category, nodes] of grouped) {
                console.log(chalk.bold.yellow(`  ${category.toUpperCase()}`));
                for (const nc of nodes) {
                    console.log(`    ${chalk.bold(nc.key)}  ${chalk.gray(nc.description)}`);
                }
                console.log('');
            }

            console.log(chalk.gray(`  ${nodeCodes.length} node code(s) registered`));
            console.log('');
        }
    });

// ─────────────────────────────────────────────────────────────────────────────
// feral catalog [key] — list catalog or show details of a single node
// ─────────────────────────────────────────────────────────────────────────────
feralCommand
    .command('catalog [key]')
    .description('List catalog nodes or show details of a specific node')
    .action(async (key?: string) => {
        const runtime = await bootstrapFeral();

        if (key) {
            // Show detail for a single catalog node
            try {
                const node = runtime.catalog.getCatalogNode(key);
                console.log(chalk.cyan(`\n🔀 Catalog Node: ${chalk.bold(node.key)}\n`));
                console.log(`  ${chalk.gray('Name:')}         ${node.name || chalk.gray('(none)')}`);
                console.log(`  ${chalk.gray('Group:')}        ${node.group}`);
                console.log(`  ${chalk.gray('NodeCode:')}     ${node.nodeCodeKey}`);
                console.log(`  ${chalk.gray('Description:')}  ${node.description || chalk.gray('(none)')}`);

                // Show preconfigured values
                const configEntries = Object.entries(node.configuration);
                if (configEntries.length > 0) {
                    console.log(`\n  ${chalk.yellow('Preconfigured Values:')}`);
                    for (const [k, v] of configEntries) {
                        console.log(`    ${chalk.bold(k)}: ${chalk.green(JSON.stringify(v))}`);
                    }
                }

                // Show available config keys from the underlying NodeCode
                try {
                    const nc = runtime.nodeCodeFactory.getNodeCode(node.nodeCodeKey);
                    const Ctor = nc.constructor as { configDescriptions?: ConfigurationDescription[] };
                    const descriptions = Ctor.configDescriptions ?? [];
                    if (descriptions.length > 0) {
                        console.log(`\n  ${chalk.yellow('Available Configuration Keys:')}`);
                        for (const desc of descriptions) {
                            const optional = desc.isOptional ? chalk.gray(' (optional)') : chalk.red(' (required)');
                            const defaultVal = desc.default != null ? chalk.gray(` [default: ${desc.default}]`) : '';
                            console.log(`    ${chalk.bold(desc.key)}${optional}${defaultVal}`);
                            console.log(chalk.gray(`      ${desc.description}`));
                            if (desc.options) {
                                console.log(chalk.gray(`      options: ${desc.options.join(', ')}`));
                            }
                        }
                    }
                } catch {
                    // NodeCode not found, skip config display
                }

                console.log('');
            } catch (err) {
                console.log(chalk.red(`\n  Catalog node "${key}" not found.\n`));
                console.log(chalk.gray('  Run `phaibel feral catalog` to see all available nodes.\n'));
            }
        } else {
            // List all catalog nodes
            const allNodes = runtime.catalog.getAllCatalogNodes();
            console.log(chalk.cyan('\n🔀 Feral Catalog\n'));

            // Group by group field
            const grouped = new Map<string, typeof allNodes>();
            for (const node of allNodes) {
                const group = node.group || 'Ungrouped';
                if (!grouped.has(group)) grouped.set(group, []);
                grouped.get(group)!.push(node);
            }

            for (const [group, nodes] of grouped) {
                console.log(chalk.bold.yellow(`  ${group.toUpperCase()}`));
                for (const node of nodes) {
                    const configCount = Object.keys(node.configuration).length;
                    const configBadge = configCount > 0 ? chalk.green(` [${configCount} config]`) : '';
                    console.log(`    ${chalk.bold(node.key)}${configBadge}  ${chalk.gray(node.description || node.name)}`);
                }
                console.log('');
            }

            console.log(chalk.gray(`  ${allNodes.length} catalog node(s) from built-in + config`));
            console.log(chalk.gray(`  Config: ${await getFeralCatalogPath()}`));
            console.log('');
        }
    });

// ─────────────────────────────────────────────────────────────────────────────
// feral process [key] — list processes or show an ASCII tree for one
// ─────────────────────────────────────────────────────────────────────────────
feralCommand
    .command('process [key]')
    .description('List processes or show an ASCII flow tree for a specific one')
    .action(async (key?: string) => {
        const runtime = await bootstrapFeral();

        if (key) {
            // Show detail + ASCII tree for a single process
            try {
                const process = runtime.processFactory.build(key);
                console.log(chalk.cyan(`\n🔀 Process: ${chalk.bold(process.key)}\n`));
                console.log(`  ${chalk.gray(process.description)}`);
                console.log(`  ${chalk.gray(`${process.nodes.length} node(s), ${process.edges.length} edge(s)`)}`);
                console.log('');
                renderProcessTree(process);
                console.log('');
            } catch {
                console.log(chalk.red(`\n  Process "${key}" not found.\n`));
                console.log(chalk.gray('  Run `phaibel feral process` to see all available processes.\n'));
            }
        } else {
            // List all processes
            const allProcesses = runtime.processFactory.getAllProcesses();
            console.log(chalk.cyan('\n🔀 Feral Processes\n'));

            // Group by prefix (e.g. "tasks", "notes", "goals")
            const grouped = new Map<string, Process[]>();
            for (const p of allProcesses) {
                const prefix = p.key.split('.')[0] || 'other';
                if (!grouped.has(prefix)) grouped.set(prefix, []);
                grouped.get(prefix)!.push(p);
            }

            for (const [prefix, processes] of grouped) {
                console.log(chalk.bold.yellow(`  ${prefix.toUpperCase()}`));
                for (const p of processes) {
                    const nodeCount = chalk.gray(`[${p.nodes.length} nodes]`);
                    console.log(`    ${chalk.bold(p.key)}  ${nodeCount}  ${chalk.gray(p.description)}`);
                }
                console.log('');
            }

            console.log(chalk.gray(`  ${allProcesses.length} process(es) loaded`));
            console.log('');
        }
    });

// ─────────────────────────────────────────────────────────────────────────────
// ASCII Tree Renderer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render a process as an ASCII tree starting from the "start" node.
 * Each node shows:  nodeKey [catalogNodeKey]
 * Edges show:  ├─ resultStatus ──▸ nextNode [catalogNodeKey]
 */
function renderProcessTree(process: Process): void {
    // Build adjacency: fromKey → [{ result, toKey }]
    const adjacency = new Map<string, { result: string; toKey: string }[]>();
    for (const edge of process.edges) {
        if (!adjacency.has(edge.fromKey)) adjacency.set(edge.fromKey, []);
        adjacency.get(edge.fromKey)!.push({ result: edge.result, toKey: edge.toKey });
    }

    // Build node lookup
    const nodeMap = new Map<string, typeof process.nodes[0]>();
    for (const node of process.nodes) {
        nodeMap.set(node.key, node);
    }

    // Find start node
    const startKey = process.nodes.find(n => n.catalogNodeKey === 'start')?.key ?? process.nodes[0]?.key;
    if (!startKey) {
        console.log(chalk.gray('  (empty process)'));
        return;
    }

    const startNode = nodeMap.get(startKey)!;
    const expanded = new Set<string>();
    console.log(`  ${formatNodeLabel(startNode)}`);
    expanded.add(startKey);
    printEdges(startKey, '  ', expanded, adjacency, nodeMap);
}

function formatNodeLabel(node: { key: string; catalogNodeKey: string; configuration: Record<string, unknown> }): string {
    const label = chalk.bold.white(node.key) + chalk.gray(` [${node.catalogNodeKey}]`);
    const configCount = Object.keys(node.configuration).length;
    const configBadge = configCount > 0 ? chalk.green(` {${configCount} config}`) : '';
    return `${label}${configBadge}`;
}

/**
 * Print the outgoing edges from a node, recursively expanding children.
 */
function printEdges(
    nodeKey: string,
    indent: string,
    expanded: Set<string>,
    adjacency: Map<string, { result: string; toKey: string }[]>,
    nodeMap: Map<string, { key: string; catalogNodeKey: string; configuration: Record<string, unknown> }>,
): void {
    const edges = adjacency.get(nodeKey) ?? [];

    for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        const isLastEdge = i === edges.length - 1;
        const connector = isLastEdge ? '└─' : '├─';
        const childIndent = indent + (isLastEdge ? '   ' : '│  ');

        const targetNode = nodeMap.get(edge.toKey);
        if (!targetNode) {
            console.log(`${indent}${connector} ${chalk.cyan(edge.result)} ──▸ ${chalk.red(edge.toKey + ' (missing)')}`);
            continue;
        }

        // Print the edge line with the target node inline
        const alreadyExpanded = expanded.has(edge.toKey);
        const targetHasEdges = (adjacency.get(edge.toKey) ?? []).length > 0;
        const revisitMarker = alreadyExpanded && targetHasEdges ? chalk.yellow(' ↻') : '';
        console.log(`${indent}${connector} ${chalk.cyan(edge.result)} ──▸ ${formatNodeLabel(targetNode)}${revisitMarker}`);

        // Recurse if this node hasn't been expanded yet and has outgoing edges
        if (!alreadyExpanded && targetHasEdges) {
            expanded.add(edge.toKey);
            printEdges(edge.toKey, childIndent, expanded, adjacency, nodeMap);
        }
    }
}

