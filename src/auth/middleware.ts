// ─────────────────────────────────────────────────────────────────────────────
// Auth Middleware — extract and verify Bearer token from HTTP requests
// ─────────────────────────────────────────────────────────────────────────────

import type http from 'node:http';
import { verifyAccessToken, type JwtPayload } from './jwt.js';
import { getJwtSecret } from './secrets.js';

export interface AuthContext {
    userId: string;
    email: string;
    plan: string;
}

export function extractBearer(req: http.IncomingMessage): string | null {
    const header = req.headers['authorization'] ?? '';
    if (!header.startsWith('Bearer ')) return null;
    return header.slice(7).trim() || null;
}

export async function requireAuth(
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<AuthContext | null> {
    const token = extractBearer(req);
    if (!token) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing authorization token' }));
        return null;
    }
    try {
        const secret = await getJwtSecret();
        const payload: JwtPayload = verifyAccessToken(token, secret);
        return { userId: payload.sub, email: payload.email, plan: payload.plan };
    } catch {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid or expired token' }));
        return null;
    }
}
