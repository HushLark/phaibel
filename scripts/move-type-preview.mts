import { previewMoveContextType } from '../src/cxms/move-context-type.js';
for (const [id, label] of [['z1b90oas','Denete'],['zii1g1bd','Taiden']] as const) {
  const p = await previewMoveContextType(id, 'person', 'family');
  console.log(`\n=== ${label} (${id}) person → family ===`);
  console.log('ready:', p.ready);
  console.log('carried:', p.fields.carried);
  console.log('defaulted:', p.fields.defaulted);
  console.log('dropped:', p.fields.dropped);
  console.log('missingRequired:', p.fields.missingRequired);
  console.log('inboundLinks:', p.inboundLinks);
  console.log('relevanceWarnings:', p.relevanceWarnings);
}
process.exit(0);
