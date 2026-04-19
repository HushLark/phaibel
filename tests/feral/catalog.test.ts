import { describe, it, expect } from 'vitest';
import { BuiltInCatalogSource } from '../../src/feral/catalog/built-in-catalog-source.js';
import { JsonCatalogSource } from '../../src/feral/catalog/json-catalog-source.js';
import { Catalog } from '../../src/feral/catalog/catalog.js';
import { NodeCodeFactory } from '../../src/feral/node-code/node-code-factory.js';
import { bootstrapFeral } from '../../src/feral/bootstrap.js';

import { StartNodeCode } from '../../src/feral/node-code/flow/start-node-code.js';
import { StopNodeCode } from '../../src/feral/node-code/flow/stop-node-code.js';
import { HttpNodeCode } from '../../src/feral/node-code/data/http-node-code.js';

describe('BuiltInCatalogSource', () => {
    it('should create a CatalogNode for every registered NodeCode', () => {
        const factory = new NodeCodeFactory([{
            getNodeCodes: () => [new StartNodeCode(), new StopNodeCode(), new HttpNodeCode()],
        }]);
        const source = new BuiltInCatalogSource(factory);
        const nodes = source.getCatalogNodes();

        expect(nodes).toHaveLength(3);
        expect(nodes.map(n => n.key)).toEqual(['start', 'stop', 'http']);
        expect(nodes[0].nodeCodeKey).toBe('start');
        expect(nodes[0].group).toBe('flow');
        expect(nodes[2].group).toBe('data');
    });
});

describe('JsonCatalogSource', () => {
    it('should create CatalogNodes from JSON config', () => {
        const source = new JsonCatalogSource({
            catalog_nodes: [
                {
                    key: 'fetch_user_api',
                    node_code_key: 'http',
                    name: 'Fetch User API',
                    group: 'API',
                    description: 'Fetches user data',
                    configuration: { url: 'https://api.example.com/users', method: 'GET' },
                },
            ],
        });
        const nodes = source.getCatalogNodes();

        expect(nodes).toHaveLength(1);
        expect(nodes[0].key).toBe('fetch_user_api');
        expect(nodes[0].nodeCodeKey).toBe('http');
        expect(nodes[0].name).toBe('Fetch User API');
        expect(nodes[0].group).toBe('API');
        expect(nodes[0].configuration).toEqual({ url: 'https://api.example.com/users', method: 'GET' });
    });

    it('should handle empty config', () => {
        const source = new JsonCatalogSource({ catalog_nodes: [] });
        expect(source.getCatalogNodes()).toEqual([]);
    });
});

describe('Combined Catalog', () => {
    it('should include both built-in and user-defined nodes', () => {
        const factory = new NodeCodeFactory([{
            getNodeCodes: () => [new StartNodeCode(), new StopNodeCode()],
        }]);

        const catalog = new Catalog([
            new BuiltInCatalogSource(factory),
            new JsonCatalogSource({
                catalog_nodes: [{
                    key: 'custom_start',
                    node_code_key: 'start',
                    name: 'Custom Start',
                    group: 'Custom',
                }],
            }),
        ]);

        const allNodes = catalog.getAllCatalogNodes();
        expect(allNodes).toHaveLength(3); // start, stop, custom_start

        // Built-ins available
        expect(catalog.getCatalogNode('start').nodeCodeKey).toBe('start');
        expect(catalog.getCatalogNode('stop').nodeCodeKey).toBe('stop');

        // User-defined available
        const custom = catalog.getCatalogNode('custom_start');
        expect(custom.nodeCodeKey).toBe('start');
        expect(custom.name).toBe('Custom Start');
    });
});

describe('bootstrapFeral', () => {
    it('should create a fully wired runtime with all built-in node codes', async () => {
        const runtime = await bootstrapFeral();

        // NodeCodeFactory should have all built-ins (56 in array + 2 late-registered)
        const nodeCodes = runtime.nodeCodeFactory.getAllNodeCodes();
        expect(nodeCodes.length).toBeGreaterThanOrEqual(55);

        // Catalog should have built-in + Slack + Agent + Entity + System + other catalog sources
        const catalogNodes = runtime.catalog.getAllCatalogNodes();
        expect(catalogNodes.length).toBeGreaterThanOrEqual(50);

        // Each built-in should map 1:1
        expect(runtime.catalog.getCatalogNode('start').nodeCodeKey).toBe('start');
        expect(runtime.catalog.getCatalogNode('http').nodeCodeKey).toBe('http');
        expect(runtime.catalog.getCatalogNode('counter').nodeCodeKey).toBe('counter');

        // Engine and runner should be defined
        expect(runtime.engine).toBeDefined();
        expect(runtime.runner).toBeDefined();
        expect(runtime.eventDispatcher).toBeDefined();
    });
});
