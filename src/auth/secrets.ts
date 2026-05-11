// ─────────────────────────────────────────────────────────────────────────────
// Auth Secrets — JWT secret auto-generated and persisted in secrets.json
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes } from 'node:crypto';
import { loadSecrets, saveSecrets } from '../config.js';

export async function getJwtSecret(): Promise<string> {
    const secrets = await loadSecrets();
    if (secrets.jwtSecret && typeof secrets.jwtSecret === 'string') {
        return secrets.jwtSecret;
    }
    // Auto-generate on first use
    const secret = randomBytes(48).toString('hex');
    (secrets as Record<string, unknown>).jwtSecret = secret;
    await saveSecrets(secrets);
    return secret;
}
