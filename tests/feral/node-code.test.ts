import { describe, it, expect } from 'vitest';
import { DefaultContext } from '../../src/feral/context/context.js';
import { ResultStatus } from '../../src/feral/result/result.js';
import { NodeCodeFactory } from '../../src/feral/node-code/node-code-factory.js';
import { InvalidNodeCodeKeyError } from '../../src/feral/errors.js';
import type { NodeCode } from '../../src/feral/node-code/node-code.js';

// Flow nodes
import { StartNodeCode } from '../../src/feral/node-code/flow/start-node-code.js';
import { StopNodeCode } from '../../src/feral/node-code/flow/stop-node-code.js';
import { NoopNodeCode } from '../../src/feral/node-code/flow/noop-node-code.js';
import { ComparatorNodeCode } from '../../src/feral/node-code/flow/comparator-node-code.js';
import { ContextValueResultNodeCode } from '../../src/feral/node-code/flow/context-value-result-node-code.js';
import { ThrowExceptionNodeCode } from '../../src/feral/node-code/flow/throw-exception-node-code.js';

// Data nodes
import { SetContextValueNodeCode } from '../../src/feral/node-code/data/set-context-value-node-code.js';
import { SetContextTableNodeCode } from '../../src/feral/node-code/data/set-context-table-node-code.js';
import { CalculationNodeCode } from '../../src/feral/node-code/data/calculation-node-code.js';
import { CounterNodeCode } from '../../src/feral/node-code/data/counter-node-code.js';
import { JsonDecodeNodeCode } from '../../src/feral/node-code/data/json-decode-node-code.js';
import { JsonEncodeNodeCode } from '../../src/feral/node-code/data/json-encode-node-code.js';
import { LogNodeCode } from '../../src/feral/node-code/data/log-node-code.js';

import { ConfigurationValueType } from '../../src/feral/configuration/configuration-value.js';

describe('NodeCodeFactory', () => {
    it('should register and retrieve node codes', () => {
        const factory = new NodeCodeFactory([
            { getNodeCodes: () => [new StartNodeCode(), new StopNodeCode()] },
        ]);
        expect(factory.getNodeCode('start')).toBeDefined();
        expect(factory.getNodeCode('stop')).toBeDefined();
    });

    it('should throw for unknown keys', () => {
        const factory = new NodeCodeFactory([]);
        expect(() => factory.getNodeCode('unknown')).toThrow(InvalidNodeCodeKeyError);
    });

    it('should list all node codes', () => {
        const factory = new NodeCodeFactory([
            { getNodeCodes: () => [new StartNodeCode(), new StopNodeCode(), new NoopNodeCode()] },
        ]);
        expect(factory.getAllNodeCodes()).toHaveLength(3);
    });
});

describe('Flow Nodes', () => {
    it('StartNodeCode should return OK', async () => {
        const node = new StartNodeCode();
        const result = await node.process(new DefaultContext());
        expect(result.status).toBe(ResultStatus.OK);
    });

    it('StopNodeCode should return STOP', async () => {
        const node = new StopNodeCode();
        const result = await node.process(new DefaultContext());
        expect(result.status).toBe(ResultStatus.STOP);
    });

    it('NoopNodeCode should return OK', async () => {
        const node = new NoopNodeCode();
        const result = await node.process(new DefaultContext());
        expect(result.status).toBe(ResultStatus.OK);
    });

    it('ThrowExceptionNodeCode should throw', async () => {
        const node = new ThrowExceptionNodeCode();
        await expect(node.process(new DefaultContext())).rejects.toThrow('Intentional exception');
    });
});

describe('ComparatorNodeCode', () => {
    it('should return TRUE for equal numeric values', async () => {
        const node = new ComparatorNodeCode();
        node.addConfiguration([
            { key: 'left_context_path', type: ConfigurationValueType.STANDARD, value: 'a' },
            { key: 'right_context_path', type: ConfigurationValueType.OPTIONAL, value: 'b' },
        ]);

        const ctx = new DefaultContext();
        ctx.set('a', 42);
        ctx.set('b', 42);

        const result = await node.process(ctx);
        expect(result.status).toBe(ResultStatus.TRUE);
    });

    it('should return GREATER_THAN when left > right', async () => {
        const node = new ComparatorNodeCode();
        node.addConfiguration([
            { key: 'left_context_path', type: ConfigurationValueType.STANDARD, value: 'a' },
            { key: 'right_value', type: ConfigurationValueType.OPTIONAL, value: '10' },
        ]);

        const ctx = new DefaultContext();
        ctx.set('a', 20);

        const result = await node.process(ctx);
        expect(result.status).toBe(ResultStatus.GREATER_THAN);
    });

    it('should return FALSE for unequal strings', async () => {
        const node = new ComparatorNodeCode();
        node.addConfiguration([
            { key: 'left_context_path', type: ConfigurationValueType.STANDARD, value: 'a' },
            { key: 'right_value', type: ConfigurationValueType.OPTIONAL, value: 'world' },
        ]);

        const ctx = new DefaultContext();
        ctx.set('a', 'hello');

        const result = await node.process(ctx);
        expect(result.status).toBe(ResultStatus.FALSE);
    });
});

describe('ContextValueResultNodeCode', () => {
    it('should return a result based on context value', async () => {
        const node = new ContextValueResultNodeCode();
        node.addConfiguration([
            { key: 'context_path', type: ConfigurationValueType.STANDARD, value: 'status' },
        ]);

        const ctx = new DefaultContext();
        ctx.set('status', 'ok');

        const result = await node.process(ctx);
        expect(result.status).toBe('ok');
    });
});

describe('Data Nodes', () => {
    describe('SetContextValueNodeCode', () => {
        it('should set a string value', async () => {
            const node = new SetContextValueNodeCode();
            node.addConfiguration([
                { key: 'value', type: ConfigurationValueType.STANDARD, value: 'hello' },
                { key: 'context_path', type: ConfigurationValueType.STANDARD, value: 'greeting' },
                { key: 'value_type', type: ConfigurationValueType.STANDARD, value: 'string' },
            ]);

            const ctx = new DefaultContext();
            const result = await node.process(ctx);
            expect(result.status).toBe(ResultStatus.OK);
            expect(ctx.get('greeting')).toBe('hello');
        });

        it('should set an int value', async () => {
            const node = new SetContextValueNodeCode();
            node.addConfiguration([
                { key: 'value', type: ConfigurationValueType.STANDARD, value: '42' },
                { key: 'context_path', type: ConfigurationValueType.STANDARD, value: 'count' },
                { key: 'value_type', type: ConfigurationValueType.STANDARD, value: 'int' },
            ]);

            const ctx = new DefaultContext();
            await node.process(ctx);
            expect(ctx.get('count')).toBe(42);
        });
    });

    describe('SetContextTableNodeCode', () => {
        it('should set multiple values from a table', async () => {
            const node = new SetContextTableNodeCode();
            node.addConfiguration([
                { key: 'table', type: ConfigurationValueType.STANDARD, value: { a: 1, b: 'hello', c: true } },
            ]);

            const ctx = new DefaultContext();
            const result = await node.process(ctx);
            expect(result.status).toBe(ResultStatus.OK);
            expect(ctx.get('a')).toBe(1);
            expect(ctx.get('b')).toBe('hello');
            expect(ctx.get('c')).toBe(true);
        });
    });

    describe('CalculationNodeCode', () => {
        it('should add two values', async () => {
            const node = new CalculationNodeCode();
            node.addConfiguration([
                { key: 'left_context_path', type: ConfigurationValueType.STANDARD, value: 'a' },
                { key: 'right_value', type: ConfigurationValueType.OPTIONAL, value: '5' },
                { key: 'operation', type: ConfigurationValueType.STANDARD, value: 'add' },
                { key: 'result_context_path', type: ConfigurationValueType.STANDARD, value: 'sum' },
            ]);

            const ctx = new DefaultContext();
            ctx.set('a', 10);
            const result = await node.process(ctx);
            expect(result.status).toBe(ResultStatus.OK);
            expect(ctx.get('sum')).toBe(15);
        });

        it('should return ERROR for division by zero', async () => {
            const node = new CalculationNodeCode();
            node.addConfiguration([
                { key: 'left_context_path', type: ConfigurationValueType.STANDARD, value: 'a' },
                { key: 'right_value', type: ConfigurationValueType.OPTIONAL, value: '0' },
                { key: 'operation', type: ConfigurationValueType.STANDARD, value: 'divide' },
                { key: 'result_context_path', type: ConfigurationValueType.STANDARD, value: 'result' },
            ]);

            const ctx = new DefaultContext();
            ctx.set('a', 10);
            const result = await node.process(ctx);
            expect(result.status).toBe(ResultStatus.ERROR);
        });
    });

    describe('CounterNodeCode', () => {
        it('should increment a counter', async () => {
            const node = new CounterNodeCode();
            node.addConfiguration([
                { key: 'context_path', type: ConfigurationValueType.STANDARD, value: 'count' },
                { key: 'direction', type: ConfigurationValueType.STANDARD, value: 'increment' },
            ]);

            const ctx = new DefaultContext();
            ctx.set('count', 5);
            await node.process(ctx);
            expect(ctx.get('count')).toBe(6);
        });

        it('should decrement a counter', async () => {
            const node = new CounterNodeCode();
            node.addConfiguration([
                { key: 'context_path', type: ConfigurationValueType.STANDARD, value: 'count' },
                { key: 'direction', type: ConfigurationValueType.STANDARD, value: 'decrement' },
            ]);

            const ctx = new DefaultContext();
            ctx.set('count', 5);
            await node.process(ctx);
            expect(ctx.get('count')).toBe(4);
        });
    });

    describe('JsonDecodeNodeCode', () => {
        it('should decode a JSON string', async () => {
            const node = new JsonDecodeNodeCode();
            node.addConfiguration([
                { key: 'source_context_path', type: ConfigurationValueType.STANDARD, value: 'json' },
                { key: 'target_context_path', type: ConfigurationValueType.STANDARD, value: 'data' },
            ]);

            const ctx = new DefaultContext();
            ctx.set('json', '{"name":"Phaibel","level":10}');
            const result = await node.process(ctx);
            expect(result.status).toBe(ResultStatus.OK);
            expect(ctx.getObject('data')).toEqual({ name: 'Phaibel', level: 10 });
        });

        it('should return ERROR for invalid JSON', async () => {
            const node = new JsonDecodeNodeCode();
            node.addConfiguration([
                { key: 'source_context_path', type: ConfigurationValueType.STANDARD, value: 'json' },
                { key: 'target_context_path', type: ConfigurationValueType.STANDARD, value: 'data' },
            ]);

            const ctx = new DefaultContext();
            ctx.set('json', '{invalid json}');
            const result = await node.process(ctx);
            expect(result.status).toBe(ResultStatus.ERROR);
        });
    });

    describe('JsonEncodeNodeCode', () => {
        it('should encode an object to JSON', async () => {
            const node = new JsonEncodeNodeCode();
            node.addConfiguration([
                { key: 'source_context_path', type: ConfigurationValueType.STANDARD, value: 'data' },
                { key: 'target_context_path', type: ConfigurationValueType.STANDARD, value: 'json' },
            ]);

            const ctx = new DefaultContext();
            ctx.set('data', { name: 'Phaibel' });
            const result = await node.process(ctx);
            expect(result.status).toBe(ResultStatus.OK);
            expect(ctx.getString('json')).toBe('{"name":"Phaibel"}');
        });
    });

    describe('LogNodeCode', () => {
        it('should interpolate context values in message', async () => {
            const node = new LogNodeCode();
            const logged: string[] = [];
            node.logger = (_level, msg) => logged.push(msg);
            node.addConfiguration([
                { key: 'message', type: ConfigurationValueType.STANDARD, value: 'Hello {name}, you are level {level}.' },
            ]);

            const ctx = new DefaultContext();
            ctx.set('name', 'Phaibel');
            ctx.set('level', 42);

            const result = await node.process(ctx);
            expect(result.status).toBe(ResultStatus.OK);
            expect(logged[0]).toBe('Hello Phaibel, you are level 42.');
        });
    });
});
