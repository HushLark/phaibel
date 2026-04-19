import { describe, it, expect } from 'vitest';
import { DefaultContext } from '../../src/feral/context/context.js';
import { EventDispatcher } from '../../src/feral/events/event-dispatcher.js';
import { Catalog } from '../../src/feral/catalog/catalog.js';
import { createCatalogNode } from '../../src/feral/catalog/catalog-node.js';
import { NodeCodeFactory } from '../../src/feral/node-code/node-code-factory.js';
import { ProcessEngine } from '../../src/feral/engine/process-engine.js';
import { ProcessFactory } from '../../src/feral/process/process-factory.js';
import { Runner } from '../../src/feral/runner/runner.js';
import { hydrateProcess } from '../../src/feral/process/process-json-hydrator.js';
import type { ProcessConfigJson } from '../../src/feral/process/process-json-hydrator.js';

import { StartNodeCode } from '../../src/feral/node-code/flow/start-node-code.js';
import { StopNodeCode } from '../../src/feral/node-code/flow/stop-node-code.js';
import { SetContextValueNodeCode } from '../../src/feral/node-code/data/set-context-value-node-code.js';
import { CounterNodeCode } from '../../src/feral/node-code/data/counter-node-code.js';

describe('Runner — End-to-End', () => {
    it('should run a process and return the context', async () => {
        const dispatcher = new EventDispatcher();

        const catalog = new Catalog([{
            getCatalogNodes: () => [
                createCatalogNode({ key: 'catalog_start', nodeCodeKey: 'start' }),
                createCatalogNode({ key: 'catalog_stop', nodeCodeKey: 'stop' }),
                createCatalogNode({ key: 'catalog_set_value', nodeCodeKey: 'set_context_value' }),
                createCatalogNode({ key: 'catalog_counter', nodeCodeKey: 'counter' }),
            ],
        }]);

        const nodeCodeFactory = new NodeCodeFactory([{
            getNodeCodes: () => [
                new StartNodeCode(),
                new StopNodeCode(),
                new SetContextValueNodeCode(),
                new CounterNodeCode(),
            ],
        }]);

        const processJson: ProcessConfigJson = {
            schema_version: 1,
            key: 'e2e-test',
            description: 'End-to-end runner test',
            context: { initial: 'from-process' },
            nodes: [
                { key: 'start', catalog_node_key: 'catalog_start', configuration: {}, edges: { ok: 'set_name' } },
                {
                    key: 'set_name',
                    catalog_node_key: 'catalog_set_value',
                    configuration: { value: 'Phaibel', context_path: 'assistant', value_type: 'string' },
                    edges: { ok: 'count_up' },
                },
                {
                    key: 'count_up',
                    catalog_node_key: 'catalog_counter',
                    configuration: { context_path: 'visits', direction: 'increment' },
                    edges: { ok: 'end' },
                },
                { key: 'end', catalog_node_key: 'catalog_stop', configuration: {}, edges: {} },
            ],
        };

        const process = hydrateProcess(processJson);
        const engine = new ProcessEngine(dispatcher, catalog, nodeCodeFactory);
        const processFactory = new ProcessFactory([{ getProcesses: () => [process] }]);
        const runner = new Runner(processFactory, engine);

        const ctx = await runner.run('e2e-test', { visits: 5 });

        // Process context should be merged
        expect(ctx.get('initial')).toBe('from-process');
        // Set value node should have set 'assistant'
        expect(ctx.get('assistant')).toBe('Phaibel');
        // Counter should have incremented
        expect(ctx.get('visits')).toBe(6);
    });

    it('should throw for unknown process key', async () => {
        const dispatcher = new EventDispatcher();
        const catalog = new Catalog([]);
        const nodeCodeFactory = new NodeCodeFactory([]);
        const engine = new ProcessEngine(dispatcher, catalog, nodeCodeFactory);
        const processFactory = new ProcessFactory([]);
        const runner = new Runner(processFactory, engine);

        await expect(() => runner.run('unknown-process')).rejects.toThrow('Cannot find process');
    });
});
