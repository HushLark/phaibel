// ─────────────────────────────────────────────────────────────────────────────
// Encryption — AES-256-GCM for BYOK key storage (no external deps)
// ─────────────────────────────────────────────────────────────────────────────
//
// Stored format: <iv-hex>:<authTag-hex>:<ciphertext-hex>
// Encryption key is derived per user: sha256(jwtSecret + userId)
// ─────────────────────────────────────────────────────────────────────────────

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function deriveKey(jwtSecret: string, userId: string): Buffer {
    return createHash('sha256').update(jwtSecret + userId).digest();
}

export function encryptApiKey(plaintext: string, jwtSecret: string, userId: string): string {
    const key = deriveKey(jwtSecret, userId);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

export function decryptApiKey(stored: string, jwtSecret: string, userId: string): string {
    const [ivHex, tagHex, ctHex] = stored.split(':');
    const key = deriveKey(jwtSecret, userId);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]);
    return plaintext.toString('utf8');
}
