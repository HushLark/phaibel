// ─────────────────────────────────────────────────────────────────────────────
// Auth Router — signup, login, refresh, logout, BYOK, magic-link exchange
//
//   POST /auth/signup       { email, password, plan? }
//   POST /auth/login        { email, password }
//   POST /auth/refresh      { refreshToken, userId }
//   POST /auth/logout       (bearer)
//   GET  /auth/me           (bearer)
//   PATCH /auth/byok        (bearer) { provider, apiKey }
//   POST /auth/magic        (server-secret) { email }   → short-lived token for web→app redirect
//   POST /auth/exchange     { token }                   → JWT + refresh (completes redirect)
// ─────────────────────────────────────────────────────────────────────────────

import type http from 'node:http';
import { signAccessToken, generateRefreshToken, refreshTokenExpiresAt, generateMagicToken } from '../auth/jwt.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { encryptApiKey, decryptApiKey } from '../auth/encryption.js';
import { getJwtSecret } from '../auth/secrets.js';
import { requireAuth, extractBearer } from '../auth/middleware.js';
import {
    createUser,
    findUserByEmail,
    findUserById,
    updateUser,
    addRefreshToken,
    consumeRefreshToken,
    revokeAllRefreshTokens,
    addMagicToken,
    consumeMagicToken,
    type Plan,
} from '../auth/user-store.js';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function json(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

function err(res: http.ServerResponse, status: number, message: string): void {
    json(res, status, { error: message });
}

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

async function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    const raw = await readBody(req);
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return {}; }
}

async function issueTokens(userId: string, email: string, plan: string) {
    const secret = await getJwtSecret();
    const accessToken = signAccessToken(userId, email, plan, secret);
    const refreshToken = generateRefreshToken();
    const expiresAt = refreshTokenExpiresAt();
    await addRefreshToken(userId, refreshToken, expiresAt);
    return { accessToken, refreshToken, expiresAt };
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTER
// ─────────────────────────────────────────────────────────────────────────────

export async function handleAuthRoute(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
): Promise<boolean> {
    const method = req.method ?? 'GET';
    const path = url.pathname;

    if (!path.startsWith('/auth/')) return false;

    // ── POST /auth/signup ─────────────────────────────────────────────
    if (method === 'POST' && path === '/auth/signup') {
        const body = await parseBody(req);
        const email    = typeof body.email    === 'string' ? body.email.trim()    : '';
        const password = typeof body.password === 'string' ? body.password        : '';
        const plan     = (body.plan === 'pro' ? 'pro' : 'byok') as Plan;

        if (!email || !email.includes('@')) return err(res, 400, 'Valid email required'), true;
        if (!password || password.length < 8) return err(res, 400, 'Password must be at least 8 characters'), true;

        try {
            const { hash, salt } = hashPassword(password);
            const user = await createUser(email, hash, salt, plan);
            const { accessToken, refreshToken } = await issueTokens(user.id, user.email, user.plan);
            json(res, 201, { accessToken, refreshToken, userId: user.id, email: user.email, plan: user.plan });
        } catch (e) {
            err(res, 409, e instanceof Error ? e.message : 'Signup failed');
        }
        return true;
    }

    // ── POST /auth/login ──────────────────────────────────────────────
    if (method === 'POST' && path === '/auth/login') {
        const body = await parseBody(req);
        const email    = typeof body.email    === 'string' ? body.email.trim()    : '';
        const password = typeof body.password === 'string' ? body.password        : '';

        const user = email ? await findUserByEmail(email) : null;
        if (!user || !verifyPassword(password, user.passwordHash, user.passwordSalt)) {
            return err(res, 401, 'Invalid email or password'), true;
        }
        const { accessToken, refreshToken } = await issueTokens(user.id, user.email, user.plan);
        json(res, 200, { accessToken, refreshToken, userId: user.id, email: user.email, plan: user.plan });
        return true;
    }

    // ── POST /auth/refresh ────────────────────────────────────────────
    if (method === 'POST' && path === '/auth/refresh') {
        const body = await parseBody(req);
        const userId       = typeof body.userId       === 'string' ? body.userId       : '';
        const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken : '';

        const user = userId ? await findUserById(userId) : null;
        if (!user) return err(res, 401, 'Invalid credentials'), true;

        const valid = await consumeRefreshToken(userId, refreshToken);
        if (!valid) return err(res, 401, 'Invalid or expired refresh token'), true;

        const { accessToken, refreshToken: newRefresh } = await issueTokens(user.id, user.email, user.plan);
        json(res, 200, { accessToken, refreshToken: newRefresh });
        return true;
    }

    // ── POST /auth/logout ─────────────────────────────────────────────
    if (method === 'POST' && path === '/auth/logout') {
        const auth = await requireAuth(req, res);
        if (!auth) return true;
        await revokeAllRefreshTokens(auth.userId);
        json(res, 200, { ok: true });
        return true;
    }

    // ── GET /auth/me ──────────────────────────────────────────────────
    if (method === 'GET' && path === '/auth/me') {
        const auth = await requireAuth(req, res);
        if (!auth) return true;
        const user = await findUserById(auth.userId);
        if (!user) return err(res, 404, 'User not found'), true;
        json(res, 200, {
            userId: user.id,
            email: user.email,
            plan: user.plan,
            byokProviders: Object.keys(user.byokKeys),
            createdAt: user.createdAt,
        });
        return true;
    }

    // ── PATCH /auth/byok ──────────────────────────────────────────────
    if (method === 'PATCH' && path === '/auth/byok') {
        const auth = await requireAuth(req, res);
        if (!auth) return true;

        const body     = await parseBody(req);
        const provider = typeof body.provider === 'string' ? body.provider.toLowerCase() : '';
        const apiKey   = typeof body.apiKey   === 'string' ? body.apiKey   : '';

        const allowed = ['openai', 'anthropic', 'google', 'deepseek'];
        if (!allowed.includes(provider)) return err(res, 400, `Provider must be one of: ${allowed.join(', ')}`), true;
        if (!apiKey) return err(res, 400, 'apiKey is required'), true;

        const secret = await getJwtSecret();
        const user   = await findUserById(auth.userId);
        if (!user) return err(res, 404, 'User not found'), true;

        const encrypted = encryptApiKey(apiKey, secret, auth.userId);
        user.byokKeys[provider] = encrypted;
        await updateUser(auth.userId, { byokKeys: user.byokKeys });

        json(res, 200, { ok: true, provider, configured: true });
        return true;
    }

    // ── POST /auth/magic ──────────────────────────────────────────────
    // Called server-side by phaibel.com after a successful Stripe payment.
    // Requires the server's JWT secret as a bearer token (internal use only).
    if (method === 'POST' && path === '/auth/magic') {
        const secret = await getJwtSecret();
        const bearer = extractBearer(req);
        if (bearer !== secret) return err(res, 403, 'Forbidden'), true;

        const body  = await parseBody(req);
        const email = typeof body.email === 'string' ? body.email.trim() : '';
        const plan  = (body.plan === 'pro' ? 'pro' : 'byok') as Plan;

        if (!email) return err(res, 400, 'email is required'), true;

        let user = await findUserByEmail(email);
        if (!user) {
            // Auto-create account for web-initiated signups
            user = await createUser(email, '', '', plan);
        }

        const magicToken = generateMagicToken();
        const expiresAt  = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min
        await addMagicToken(user.id, magicToken, expiresAt);

        // Return the deep-link URL the web app should redirect to
        json(res, 200, {
            token: magicToken,
            deepLink: `phaibel://auth?token=${magicToken}`,
            expiresAt,
        });
        return true;
    }

    // ── POST /auth/exchange ───────────────────────────────────────────
    // The iPhone app calls this after catching the deep-link.
    if (method === 'POST' && path === '/auth/exchange') {
        const body  = await parseBody(req);
        const token = typeof body.token === 'string' ? body.token : '';

        const user = await consumeMagicToken(token);
        if (!user) return err(res, 401, 'Invalid or expired token'), true;

        const { accessToken, refreshToken } = await issueTokens(user.id, user.email, user.plan);
        json(res, 200, { accessToken, refreshToken, userId: user.id, email: user.email, plan: user.plan });
        return true;
    }

    return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// BYOK RESOLUTION — used by the LLM router to get user's decrypted keys
// ─────────────────────────────────────────────────────────────────────────────

export async function resolveByokKeys(userId: string): Promise<Record<string, string>> {
    const user = await findUserById(userId);
    if (!user || Object.keys(user.byokKeys).length === 0) return {};
    const secret = await getJwtSecret();
    const result: Record<string, string> = {};
    for (const [provider, encrypted] of Object.entries(user.byokKeys)) {
        try {
            result[provider] = decryptApiKey(encrypted, secret, userId);
        } catch {
            // Key corrupted — skip
        }
    }
    return result;
}
