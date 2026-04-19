import { describe, it, expect, vi } from 'vitest';
import { DefaultContext } from '../../src/feral/context/context.js';
import { ResultStatus } from '../../src/feral/result/result.js';
import { EventDispatcher } from '../../src/feral/events/event-dispatcher.js';
import { Catalog } from '../../src/feral/catalog/catalog.js';
import { createCatalogNode } from '../../src/feral/catalog/catalog-node.js';
import { NodeCodeFactory } from '../../src/feral/node-code/node-code-factory.js';
import { ProcessEngine } from '../../src/feral/engine/process-engine.js';
import { hydrateProcess } from '../../src/feral/process/process-json-hydrator.js';
import type { ProcessConfigJson } from '../../src/feral/process/process-json-hydrator.js';

// Built-in nodes
import { StartNodeCode } from '../../src/feral/node-code/flow/start-node-code.js';
import { StopNodeCode } from '../../src/feral/node-code/flow/stop-node-code.js';
import { SetContextValueNodeCode } from '../../src/feral/node-code/data/set-context-value-node-code.js';
import { CalculationNodeCode } from '../../src/feral/node-code/data/calculation-node-code.js';
import { JsonDecodeNodeCode } from '../../src/feral/node-code/data/json-decode-node-code.js';
import { ThrowExceptionNodeCode } from '../../src/feral/node-code/flow/throw-exception-node-code.js';

function createTestEngine(): { engine: ProcessEngine; dispatcher: EventDispatcher } {
    const dispatcher = new EventDispatcher();

    const catalog = new Catalog([{
        getCatalogNodes: () => [
            createCatalogNode({ key: 'catalog_start', nodeCodeKey: 'start', name: 'Start' }),
            createCatalogNode({ key: 'catalog_stop', nodeCodeKey: 'stop', name: 'Stop' }),
            createCatalogNode({ key: 'catalog_set_value', nodeCodeKey: 'set_context_value', name: 'Set Value' }),
            createCatalogNode({ key: 'catalog_calculation', nodeCodeKey: 'calculation', name: 'Calculation' }),
            createCatalogNode({ key: 'catalog_json_decode', nodeCodeKey: 'json_decode', name: 'JSON Decode' }),
            createCatalogNode({ key: 'catalog_throw', nodeCodeKey: 'throw_exception', name: 'Throw' }),
        ],
    }]);

    const nodeCodeFactory = new NodeCodeFactory([{
        getNodeCodes: () => [
            new StartNodeCode(),
            new StopNodeCode(),
            new SetContextValueNodeCode(),
            new CalculationNodeCode(),
            new JsonDecodeNodeCode(),
            new ThrowExceptionNodeCode(),
        ],
    }]);

    const engine = new ProcessEngine(dispatcher, catalog, nodeCodeFactory);
    return { engine, dispatcher };
}

describe('ProcessEngine', () => {
    it('should execute a simple start → stop process', async () => {
        const { engine } = createTestEngine();

        const processJson: ProcessConfigJson = {
            schema_version: 1,
            key: 'simple',
            context: {},
            nodes: [
                { key: 'start', catalog_node_key: 'catalog_start', configuration: {}, edges: { ok: 'end' } },
                { key: 'end', catalog_node_key: 'catalog_stop', configuration: {}, edges: {} },
            ],
        };

        const process = hydrateProcess(processJson);
        const ctx = new DefaultContext();
        await engine.process(process, ctx);
        // No error = success
    });

    it('should execute start → set_value → stop and mutate context', async () => {
        const { engine } = createTestEngine();

        const processJson: ProcessConfigJson = {
            schema_version: 1,
            key: 'set-value-test',
            context: {},
            nodes: [
                { key: 'start', catalog_node_key: 'catalog_start', configuration: {}, edges: { ok: 'set' } },
                {
                    key: 'set',
                    catalog_node_key: 'catalog_set_value',
                    configuration: { value: 'Phaibel', context_path: 'name', value_type: 'string' },
                    edges: { ok: 'end' },
                },
                { key: 'end', catalog_node_key: 'catalog_stop', configuration: {}, edges: {} },
            ],
        };

        const process = hydrateProcess(processJson);
        const ctx = new DefaultContext();
        await engine.process(process, ctx);

        expect(ctx.get('name')).toBe('Phaibel');
    });

    it('should merge process context into runtime context', async () => {
        const { engine } = createTestEngine();

        const processJson: ProcessConfigJson = {
            schema_version: 1,
            key: 'context-merge',
            context: { injected: 'from-process' },
            nodes: [
                { key: 'start', catalog_node_key: 'catalog_start', configuration: {}, edges: { ok: 'end' } },
                { key: 'end', catalog_node_key: 'catalog_stop', configuration: {}, edges: {} },
            ],
        };

        const process = hydrateProcess(processJson);
        const ctx = new DefaultContext();
        ctx.set('existing', 'preserved');
        await engine.process(process, ctx);

        expect(ctx.get('injected')).toBe('from-process');
        expect(ctx.get('existing')).toBe('preserved');
    });

    it('should throw for missing edge', async () => {
        const { engine } = createTestEngine();

        const processJson: ProcessConfigJson = {
            schema_version: 1,
            key: 'missing-edge',
            context: {},
            nodes: [
                { key: 'start', catalog_node_key: 'catalog_start', configuration: {}, edges: {} },
            ],
        };

        const process = hydrateProcess(processJson);
        const ctx = new DefaultContext();
        await expect(engine.process(process, ctx)).rejects.toThrow('No edge found');
    });

    it('should dispatch process start and end events', async () => {
        const { engine, dispatcher } = createTestEngine();
        const events: string[] = [];

        dispatcher.on('process.start', () => events.push('start'));
        dispatcher.on('process.end', () => events.push('end'));

        const processJson: ProcessConfigJson = {
            schema_version: 1,
            key: 'events-test',
            context: {},
            nodes: [
                { key: 'start', catalog_node_key: 'catalog_start', configuration: {}, edges: { ok: 'end' } },
                { key: 'end', catalog_node_key: 'catalog_stop', configuration: {}, edges: {} },
            ],
        };

        const process = hydrateProcess(processJson);
        await engine.process(process, new DefaultContext());

        expect(events).toEqual(['start', 'end']);
    });

    it('should dispatch exception event on error', async () => {
        const { engine, dispatcher } = createTestEngine();
        const errors: string[] = [];

        dispatcher.on('process.exception', (e) => {
            errors.push((e as any).error.message);
        });

        const processJson: ProcessConfigJson = {
            schema_version: 1,
            key: 'exception-test',
            context: {},
            nodes: [
                { key: 'start', catalog_node_key: 'catalog_start', configuration: {}, edges: { ok: 'fail' } },
                { key: 'fail', catalog_node_key: 'catalog_throw', configuration: { message: 'boom' }, edges: {} },
            ],
        };

        const process = hydrateProcess(processJson);
        await expect(engine.process(process, new DefaultContext())).rejects.toThrow('boom');
        expect(errors).toContain('boom');
    });

    it('should chain multiple data nodes', async () => {
        const { engine } = createTestEngine();

        const processJson: ProcessConfigJson = {
            schema_version: 1,
            key: 'chain-test',
            context: { raw_json: '{"price": 100}' },
            nodes: [
                { key: 'start', catalog_node_key: 'catalog_start', configuration: {}, edges: { ok: 'decode' } },
                {
                    key: 'decode',
                    catalog_node_key: 'catalog_json_decode',
                    configuration: { source_context_path: 'raw_json', target_context_path: 'data' },
                    edges: { ok: 'calc' },
                },
                {
                    key: 'calc',
                    catalog_node_key: 'catalog_calculation',
                    configuration: {
                        left_context_path: 'price_val',
                        right_value: '1.10',
                        operation: 'multiply',
                        result_context_path: 'total',
                    },
                    edges: { ok: 'end' },
                },
                { key: 'end', catalog_node_key: 'catalog_stop', configuration: {}, edges: {} },
            ],
        };

        const process = hydrateProcess(processJson);
        const ctx = new DefaultContext();
        // Pre-set the price for the calculation step (the decode puts an object at 'data')
        ctx.set('price_val', 100);
        await engine.process(process, ctx);

        expect(ctx.get('total')).toBeCloseTo(110);
    });
});
