import { describe, it, expect } from 'vitest';
import { DefaultContext } from '../../src/feral/context/context.js';

describe('DefaultContext', () => {
    it('should set and get values', () => {
        const ctx = new DefaultContext();
        ctx.set('name', 'Phaibel');
        expect(ctx.get('name')).toBe('Phaibel');
    });

    it('should return null for missing keys', () => {
        const ctx = new DefaultContext();
        expect(ctx.get('missing')).toBeNull();
    });

    it('should report has() correctly', () => {
        const ctx = new DefaultContext();
        expect(ctx.has('key')).toBe(false);
        ctx.set('key', 'value');
        expect(ctx.has('key')).toBe(true);
    });

    it('should handle has() for null values', () => {
        const ctx = new DefaultContext();
        ctx.set('key', null);
        expect(ctx.has('key')).toBe(false);
    });

    it('should remove values', () => {
        const ctx = new DefaultContext();
        ctx.set('key', 'value');
        ctx.remove('key');
        expect(ctx.has('key')).toBe(false);
        expect(ctx.get('key')).toBeNull();
    });

    it('should clear values', () => {
        const ctx = new DefaultContext();
        ctx.set('key', 'value');
        expect(ctx.clear('key')).toBe(true);
        expect(ctx.has('key')).toBe(false);
    });

    it('should return false when clearing non-existent key', () => {
        const ctx = new DefaultContext();
        expect(ctx.clear('missing')).toBe(false);
    });

    it('should return all values as a copy', () => {
        const ctx = new DefaultContext();
        ctx.set('a', 1);
        ctx.set('b', 'hello');
        const all = ctx.getAll();
        expect(all).toEqual({ a: 1, b: 'hello' });

        // Verify it's a copy
        all['c'] = 'mutated';
        expect(ctx.has('c')).toBe(false);
    });

    describe('typed accessors', () => {
        it('getInt should return integer', () => {
            const ctx = new DefaultContext();
            ctx.set('num', '42.9');
            expect(ctx.getInt('num')).toBe(42);
        });

        it('getFloat should return float', () => {
            const ctx = new DefaultContext();
            ctx.set('num', '3.14');
            expect(ctx.getFloat('num')).toBeCloseTo(3.14);
        });

        it('getString should return string', () => {
            const ctx = new DefaultContext();
            ctx.set('val', 42);
            expect(ctx.getString('val')).toBe('42');
        });

        it('getString should return empty string for missing', () => {
            const ctx = new DefaultContext();
            expect(ctx.getString('missing')).toBe('');
        });

        it('getArray should return array', () => {
            const ctx = new DefaultContext();
            ctx.set('arr', [1, 2, 3]);
            expect(ctx.getArray('arr')).toEqual([1, 2, 3]);
        });

        it('getArray should return empty array for non-arrays', () => {
            const ctx = new DefaultContext();
            ctx.set('val', 'not an array');
            expect(ctx.getArray('val')).toEqual([]);
        });

        it('getObject should return typed object', () => {
            const ctx = new DefaultContext();
            ctx.set('obj', { name: 'test', count: 5 });
            const obj = ctx.getObject<{ name: string; count: number }>('obj');
            expect(obj.name).toBe('test');
            expect(obj.count).toBe(5);
        });
    });
});
