// ─────────────────────────────────────────────────────────────────────────────
// JWT — HS256 sign/verify using node:crypto (no external deps)
// ─────────────────────────────────────────────────────────────────────────────

import { createHmac, randomBytes } from 'node:crypto';

export interface JwtPayload {
    sub: string;      // userId
    email: string;
    plan: string;
    iat: number;
    exp: number;
}

const ACCESS_TTL_SEC  = 60 * 60;         // 1 hour
const REFRESH_TTL_SEC = 90 * 24 * 60 * 60; // 90 days

function b64url(s: string): string {
    return Buffer.from(s).toString('base64url');
}

function sign(header: string, payload: string, secret: string): string {
    return createHmac('sha256', secret)
        .update(`${header}.${payload}`)
        .digest('base64url');
}

export function signAccessToken(userId: string, email: string, plan: string, secret: string): string {
    const now = Math.floor(Date.now() / 1000);
    const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b64url(JSON.stringify({ sub: userId, email, plan, iat: now, exp: now + ACCESS_TTL_SEC }));
    const sig = sign(header, payload, secret);
    return `${header}.${payload}.${sig}`;
}

export function verifyAccessToken(token: string, secret: string): JwtPayload {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid token format');
    const [header, payload, sig] = parts;
    const expected = sign(header, payload, secret);
    if (sig !== expected) throw new Error('Invalid token signature');
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as JwtPayload;
    if (data.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
    return data;
}

export function generateRefreshToken(): string {
    return randomBytes(40).toString('hex');
}

export function refreshTokenExpiresAt(): string {
    return new Date(Date.now() + REFRESH_TTL_SEC * 1000).toISOString();
}

export function generateMagicToken(): string {
    return randomBytes(16).toString('hex');
}
