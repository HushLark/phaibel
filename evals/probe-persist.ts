import { promises as fs } from 'fs';
import path from 'path';
import { createEvalVault, destroyEvalVault } from './vault-setup.js';
import { addEntityType, loadEntityTypes, invalidateCache, updateEntityType, removeEntityType } from '../src/entities/entity-type-config.js';

async function main() {
  const vault = await createEvalVault([]);
  let types = await loadEntityTypes();
  console.log('defaults+extras loaded:', types.map(t => t.name).sort().join(', '));

  await addEntityType({
    name: 'client_account', plural: 'client_accounts', baseCategory: 'thing', parent: 'thing',
    description: 'A managed client account', defaultTags: ['client'],
    fields: [{ key: 'arr', type: 'string', label: 'ARR', required: false }],
    dimensions: { semantic: 0.9, goalAlignment: 0.8, temporal: 0.3 },
    temporal: { attack: 7, decay: 90 },
  } as any);

  const cxmsPath = path.join(vault, 'context-types', 'client_account', '.cxms.md');
  const raw = await fs.readFile(cxmsPath, 'utf-8');
  console.log('\n.cxms.md at:', path.relative(vault, cxmsPath));
  console.log('lossless (dims+temporal in frontmatter):', raw.includes('semantic') && raw.includes('goalAlignment') && raw.includes('attack'));

  invalidateCache();
  const ct = (await loadEntityTypes()).find(t => t.name === 'client_account') as any;
  console.log('reloaded:', !!ct, '| dir:', ct?.directory, '| dims:', JSON.stringify(ct?.dimensions), '| temporal:', JSON.stringify(ct?.temporal));

  const found: string[] = [];
  async function walk(dir: string) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') await walk(p); }
      else if (e.name === 'entity-types.json') found.push(path.relative(vault, p));
    }
  }
  await walk(vault);
  console.log('\nentity-types.json found:', found.length === 0 ? 'NONE ✓' : found.join(', '));

  await updateEntityType('client_account', { name: 'client_account', plural: 'client_accounts', baseCategory: 'thing', description: 'Updated desc', fields: [], dimensions: { semantic: 0.5 } } as any);
  invalidateCache();
  const up = (await loadEntityTypes()).find(t => t.name === 'client_account') as any;
  console.log('after update — desc:', up?.description, '| dims:', JSON.stringify(up?.dimensions));

  await removeEntityType('client_account');
  invalidateCache();
  console.log('after remove — type gone:', !(await loadEntityTypes()).find(t => t.name === 'client_account'),
    '| dir gone:', !(await fs.access(path.join(vault, 'context-types', 'client_account')).then(() => true).catch(() => false)));

  let guarded = false;
  try { await removeEntityType('person'); } catch { guarded = true; }
  console.log('built-in removal guarded:', guarded);

  await destroyEvalVault();
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
