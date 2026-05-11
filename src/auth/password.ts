// ─────────────────────────────────────────────────────────────────────────────
// Password — scrypt hash/verify using node:crypto (no bcrypt dep)
// ─────────────────────────────────────────────────────────────────────────────

import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

export function hashPassword(password: string): { hash: string; salt: string } {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, KEYLEN, SCRYPT_PARAMS).toString('hex');
    return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
    const derived = scryptSync(password, salt, KEYLEN, SCRYPT_PARAMS);
    const stored = Buffer.from(hash, 'hex');
    if (derived.length !== stored.length) return false;
    return timingSafeEqual(derived, stored);
}
