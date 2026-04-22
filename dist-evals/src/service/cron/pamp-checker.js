// ─────────────────────────────────────────────────────────────────────────────
// PAMP MAIL CHECKER
// Polls the Post Office for unread messages, fetches and decrypts them locally.
// ─────────────────────────────────────────────────────────────────────────────
import { loadIdentity } from '../../pamp/storage.js';
import { PampClient } from '../../pamp/client.js';
export async function checkPampMail() {
    const identity = await loadIdentity();
    if (!identity) {
        return { skipped: true, fetched: 0, errors: 0 };
    }
    const client = new PampClient(identity);
    const unread = await client.listMessages({ unread: true });
    let fetched = 0;
    let errors = 0;
    for (const envelope of unread) {
        try {
            await client.fetchAndDecryptMessage(envelope.message_id);
            await client.markRead(envelope.message_id);
            fetched++;
        }
        catch (err) {
            errors++;
            console.error(`[pamp-check] failed to fetch message ${envelope.message_id}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    return { fetched, errors };
}
