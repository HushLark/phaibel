import { describe, it, expect } from 'vitest';
import {
    resolveDimensions,
    getSpecificity,
    BASE_CATEGORY_DIMENSIONS,
    type EntityTypeConfig,
} from '../../src/entities/entity-type-config.js';

function t(over: Partial<EntityTypeConfig> & { name: string }): EntityTypeConfig {
    return { plural: over.name + 's', directory: over.name, fields: [], ...over };
}

function registry(...types: EntityTypeConfig[]): Map<string, EntityTypeConfig> {
    return new Map(types.map(x => [x.name, x]));
}

describe('getSpecificity', () => {
    it('is 0 for a generic base type (no parent)', () => {
        const person = t({ name: 'person', baseCategory: 'person' });
        expect(getSpecificity(person, registry(person))).toBe(0);
    });

    it('is 1 for a direct subtype', () => {
        const person = t({ name: 'person', baseCategory: 'person' });
        const family = t({ name: 'immediate_family', baseCategory: 'person', parent: 'person' });
        expect(getSpecificity(family, registry(person, family))).toBe(1);
    });

    it('counts the full parent chain', () => {
        const person = t({ name: 'person', baseCategory: 'person' });
        const family = t({ name: 'family', baseCategory: 'person', parent: 'person' });
        const child = t({ name: 'child', baseCategory: 'person', parent: 'family' });
        expect(getSpecificity(child, registry(person, family, child))).toBe(2);
    });

    it('is cycle-safe', () => {
        const a = t({ name: 'a', parent: 'b' });
        const b = t({ name: 'b', parent: 'a' });
        expect(getSpecificity(a, registry(a, b))).toBeLessThanOrEqual(2);
    });
});

describe('resolveDimensions', () => {
    it('uses a type\'s own dimensions when present', () => {
        const note = t({ name: 'note', baseCategory: 'thing', dimensions: [{ type: 'semantic', weight: 9 }] });
        const dims = resolveDimensions(note, registry(note));
        expect(dims).toHaveLength(1);
        expect(dims[0].weight).toBe(9);
    });

    it('inherits the parent\'s dimensions when it has none of its own', () => {
        const person = t({ name: 'person', baseCategory: 'person', dimensions: [{ type: 'socialProximity', weight: 7 }] });
        const family = t({ name: 'immediate_family', baseCategory: 'person', parent: 'person' });
        const dims = resolveDimensions(family, registry(person, family));
        expect(dims[0].weight).toBe(7);
    });

    it('falls back to the base-category profile when neither own nor parent dims exist', () => {
        const place = t({ name: 'place', baseCategory: 'place' });
        const dims = resolveDimensions(place, registry(place));
        expect(dims).toEqual(BASE_CATEGORY_DIMENSIONS.place);
        expect(dims.some(d => d.type === 'spatial')).toBe(true);
    });
});
