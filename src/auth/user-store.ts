// ─────────────────────────────────────────────────────────────────────────────
// User Store — JSON file at ~/.phaibel/users.json
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { SYSTEM_DIR } from '../paths.js';

export type Plan = 'byok' | 'pro';
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid';

export interface StoredRefreshToken {
    tokenHash: string;
    expiresAt: string;
}

export interface StoredMagicToken {
    tokenHash: string;
    expiresAt: string;
}

export interface UserRecord {
    id: string;
    email: string;
    passwordHash: string;
    passwordSalt: string;
    plan: Plan;
    byokKeys: Record<string, string>;   // provider → encrypted ciphertext
    vaultPath: string;
    createdAt: string;
    refreshTokens: StoredRefreshToken[];
    magicTokens: StoredMagicToken[];
    // Stripe billing
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    subscriptionStatus?: SubscriptionStatus;
    currentPeriodEnd?: string;          // ISO — when the current billing period ends
}

interface UsersFile {
    users: UserRecord[];
}

function usersPath(): string {
    return join(SYSTEM_DIR(), 'users.json');
}

function hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
}

async function readFile(): Promise<UsersFile> {
    try {
        const raw = await fs.readFile(usersPath(), 'utf-8');
        return JSON.parse(raw) as UsersFile;
    } catch {
        return { users: [] };
    }
}

async function writeFile(data: UsersFile): Promise<void> {
    await fs.mkdir(SYSTEM_DIR(), { recursive: true });
    await fs.writeFile(usersPath(), JSON.stringify(data, null, 2));
}

export async function createUser(
    email: string,
    passwordHash: string,
    passwordSalt: string,
    plan: Plan,
): Promise<UserRecord> {
    const data = await readFile();
    if (data.users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
        throw new Error('Email already registered');
    }
    const id = randomUUID();
    const vaultPath = join(SYSTEM_DIR(), 'vaults', id);
    const user: UserRecord = {
        id,
        email: email.toLowerCase().trim(),
        passwordHash,
        passwordSalt,
        plan,
        byokKeys: {},
        vaultPath,
        createdAt: new Date().toISOString(),
        refreshTokens: [],
        magicTokens: [],
    };
    data.users.push(user);
    await writeFile(data);
    return user;
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
    const data = await readFile();
    return data.users.find(u => u.email === email.toLowerCase().trim()) ?? null;
}

export async function findUserById(id: string): Promise<UserRecord | null> {
    const data = await readFile();
    return data.users.find(u => u.id === id) ?? null;
}

export async function findUserByStripeCustomerId(customerId: string): Promise<UserRecord | null> {
    const data = await readFile();
    return data.users.find(u => u.stripeCustomerId === customerId) ?? null;
}

export async function updateUser(id: string, patch: Partial<UserRecord>): Promise<void> {
    const data = await readFile();
    const idx = data.users.findIndex(u => u.id === id);
    if (idx === -1) throw new Error('User not found');
    data.users[idx] = { ...data.users[idx], ...patch };
    await writeFile(data);
}

export async function addRefreshToken(userId: string, rawToken: string, expiresAt: string): Promise<void> {
    const data = await readFile();
    const user = data.users.find(u => u.id === userId);
    if (!user) throw new Error('User not found');
    const now = new Date().toISOString();
    user.refreshTokens = user.refreshTokens.filter(t => t.expiresAt > now);
    user.refreshTokens.push({ tokenHash: hashToken(rawToken), expiresAt });
    await writeFile(data);
}

export async function consumeRefreshToken(userId: string, rawToken: string): Promise<boolean> {
    const data = await readFile();
    const user = data.users.find(u => u.id === userId);
    if (!user) return false;
    const hash = hashToken(rawToken);
    const now = new Date().toISOString();
    const idx = user.refreshTokens.findIndex(t => t.tokenHash === hash && t.expiresAt > now);
    if (idx === -1) return false;
    user.refreshTokens.splice(idx, 1);
    await writeFile(data);
    return true;
}

export async function revokeAllRefreshTokens(userId: string): Promise<void> {
    const data = await readFile();
    const user = data.users.find(u => u.id === userId);
    if (!user) return;
    user.refreshTokens = [];
    await writeFile(data);
}

export async function addMagicToken(userId: string, rawToken: string, expiresAt: string): Promise<void> {
    const data = await readFile();
    const user = data.users.find(u => u.id === userId);
    if (!user) throw new Error('User not found');
    const now = new Date().toISOString();
    user.magicTokens = user.magicTokens.filter(t => t.expiresAt > now);
    user.magicTokens.push({ tokenHash: hashToken(rawToken), expiresAt });
    await writeFile(data);
}

export async function consumeMagicToken(rawToken: string): Promise<UserRecord | null> {
    const data = await readFile();
    const hash = hashToken(rawToken);
    const now = new Date().toISOString();
    for (const user of data.users) {
        const idx = user.magicTokens.findIndex(t => t.tokenHash === hash && t.expiresAt > now);
        if (idx !== -1) {
            user.magicTokens.splice(idx, 1);
            await writeFile(data);
            return user;
        }
    }
    return null;
}
