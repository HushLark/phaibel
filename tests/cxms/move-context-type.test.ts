// Deterministic (LLM-independent) coverage for the CxMS write ops that regressed:
// moving a node between context types, hierarchy-aware lookup after a move, and the
// null-body guard. Reuses the eval harness vault (real v5 setup incl. the
// `immediate_family` person subtype).

import { describe, it, expect, afterEach } from 'vitest';
import { createEvalVault, destroyEvalVault } from '../../evals/vault-setup.js';
import { moveContextType, previewMoveContextType } from '../../src/cxms/move-context-type.js';
import { findNodeAnyType, findEntityByTitle, listEntities, writeEntity, type EntityTypeName } from '../../src/entities/entity.js';

afterEach(async () => { await destroyEvalVault(); });

describe('CxMS: move node between context types', () => {
    it('reclassifies person → immediate_family, preserves body, empties source, resolves via hierarchy', async () => {
        await createEvalVault([
            { entityType: 'person', title: 'Ada Lovelace', fields: { type: 'friend' }, body: 'Pioneer of computing.' },
        ]);
        const ada = (await listEntities('person' as EntityTypeName)).find(p => String(p.meta.name ?? p.meta.title).includes('Ada'));
        expect(ada).toBeTruthy();
        const id = String(ada!.meta.id);

        const res = await moveContextType(id, 'person', 'immediate_family');
        expect(res.ok).toBe(true);

        // Source type no longer contains it (moved, not copied)
        expect((await listEntities('person' as EntityTypeName)).some(p => String(p.meta.id) === id)).toBe(false);

        // Target type has it, correctly typed, body preserved
        const moved = (await listEntities('immediate_family' as EntityTypeName)).find(p => String(p.meta.id) === id);
        expect(moved).toBeTruthy();
        expect(moved!.meta.contextType).toBe('immediate_family');
        expect(moved!.content).toContain('Pioneer of computing');

        // Hierarchy-aware lookup: searching the parent type still finds it in the subtype
        const resolved = await findNodeAnyType('Ada Lovelace', 'person');
        expect(resolved?.entityType).toBe('immediate_family');
    }, 30000);

    it('preview reports the plan without writing', async () => {
        await createEvalVault([
            { entityType: 'person', title: 'Grace Hopper', fields: { type: 'colleague' }, body: 'Compiler pioneer.' },
        ]);
        const id = String((await listEntities('person' as EntityTypeName))[0].meta.id);

        const preview = await previewMoveContextType(id, 'person', 'immediate_family');
        expect(preview.toType).toBe('immediate_family');
        // preview must NOT move anything
        expect((await listEntities('person' as EntityTypeName)).some(p => String(p.meta.id) === id)).toBe(true);
        expect((await listEntities('immediate_family' as EntityTypeName)).some(p => String(p.meta.id) === id)).toBe(false);
    }, 30000);
});

describe('CxMS: hierarchy-aware find', () => {
    it('findEntityByTitle is type-scoped; findNodeAnyType follows the node to a subtype', async () => {
        await createEvalVault([
            { entityType: 'person', title: 'Alan Turing', fields: { type: 'friend' } },
        ]);
        const id = String((await listEntities('person' as EntityTypeName))[0].meta.id);
        await moveContextType(id, 'person', 'immediate_family');

        // Scoped lookup in the old type misses (the bug that caused failed renames)
        expect(await findEntityByTitle('person' as EntityTypeName, 'Alan Turing')).toBeNull();
        // Hierarchy lookup resolves it in the subtype
        const any = await findNodeAnyType('Alan Turing', 'person');
        expect(any?.entityType).toBe('immediate_family');
    }, 30000);
});

describe('CxMS: writeEntity null-body guard', () => {
    it('coerces a null/undefined body to empty (never the literal "null")', async () => {
        await createEvalVault([
            { entityType: 'note', title: 'Scratch', body: 'keep me' },
        ]);
        const note = (await listEntities('note' as EntityTypeName))[0];

        // Simulate the regression: a node-code passing a null body.
        await writeEntity(note.filepath, note.meta, null as unknown as string);

        const reread = (await listEntities('note' as EntityTypeName))[0];
        expect(reread.content.trim()).toBe('');
        expect(reread.content).not.toContain('null');
    }, 30000);
});
