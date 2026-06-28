// Posts a chat pipeline debug trace to synaptic (/v1/phaibel/debug-trace) using
// the stored synaptic credentials, refreshing the token on a 401. Mirrors the
// phaibel-app "Send debug traces" switch, which uploads the same markdown trace.
// Fire-and-forget: failures never surface to the user.

import { loadSecrets, saveSecrets } from '../config.js';
import { debug } from './debug.js';

const DEFAULT_ENDPOINT = 'https://synaptic.hushlark.ai';

export async function postDebugTrace(chatId: string, markdown: string): Promise<void> {
    try {
        const secrets = await loadSecrets();
        const syn = secrets.providers['synaptic'] as
            { apiKey?: string; endpoint?: string; refreshToken?: string } | undefined;
        if (!syn?.apiKey) return; // not signed in to synaptic — nothing to post to

        const base = (syn.endpoint ?? DEFAULT_ENDPOINT).replace(/\/$/, '');
        let token = syn.apiKey;

        const call = () => fetch(`${base}/v1/phaibel/debug-trace`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ chat_id: chatId, markdown }),
        });

        let r = await call();
        if (r.status === 401 && syn.refreshToken) {
            const rr = await fetch(`${base}/v1/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: syn.refreshToken }),
            });
            if (rr.ok) {
                const t = await rr.json() as { access_token: string; refresh_token: string };
                token = t.access_token;
                secrets.providers['synaptic'] = { ...syn, apiKey: t.access_token, refreshToken: t.refresh_token, endpoint: base };
                await saveSecrets(secrets);
                await call();
            }
        }
    } catch (err) {
        debug('debug-trace', `upload failed: ${err}`);
    }
}
