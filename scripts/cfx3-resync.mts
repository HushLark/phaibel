// Full re-sync of a CF/x3 source using the current (fixed) ingest code.
//   PHAIBEL_VAULT=<vault> npx tsx scripts/cfx3-resync.mts <sourceId>
import { syncSourceById } from '../src/cfx3/service.js';

const id = process.argv[2] ?? 'hushlark';
const out = await syncSourceById(id, { full: true });
console.log('sync outcome:', JSON.stringify(out, null, 2));
process.exit(0);
