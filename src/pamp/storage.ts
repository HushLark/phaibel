// ─────────────────────────────────────────────────────────────────────────────
// PAMP — Local Storage
// ─────────────────────────────────────────────────────────────────────────────
//
// Manages {vault}/.phaibel/pamp/ directory structure:
//   identity.json, sessions/, contacts/, inbox/, sent/, threads/
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'fs';
import path from 'path';
import type { PampIdentity, PampSession, PampContact, PampMessage } from './types.js';
import { getPampDir } from '../paths.js';

// ── Directory Setup ─────────────────────────────────────────────────────────

const SUBDIRS = ['sessions', 'contacts', 'inbox', 'sent', 'threads'];

let _resolvedDir: string | null = null;

async function pampDir(): Promise<string> {
    if (!_resolvedDir) {
        _resolvedDir = await getPampDir();
    }
    return _resolvedDir;
}

export async function ensurePampDirs(): Promise<void> {
    const dir = await pampDir();
    for (const sub of SUBDIRS) {
        await fs.mkdir(path.join(dir, sub), { recursive: true });
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function readJson<T>(filePath: string): Promise<T | null> {
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data) as T;
    } catch {
        return null;
    }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function listJsonFiles(dir: string): Promise<string[]> {
    try {
        const entries = await fs.readdir(dir);
        return entries.filter(e => e.endsWith('.json'));
    } catch {
        return [];
    }
}

// ── Identity ────────────────────────────────────────────────────────────────

export async function saveIdentity(identity: PampIdentity): Promise<void> {
    await ensurePampDirs();
    const dir = await pampDir();
    await writeJson(path.join(dir, 'identity.json'), identity);
}

export async function loadIdentity(): Promise<PampIdentity | null> {
    const dir = await pampDir();
    return readJson<PampIdentity>(path.join(dir, 'identity.json'));
}

export async function requireIdentity(): Promise<PampIdentity> {
    const identity = await loadIdentity();
    if (!identity) {
        throw new Error('PAMP not set up. Run `phaibel pamp setup` first.');
    }
    return identity;
}

// ── Sessions ────────────────────────────────────────────────────────────────

export async function saveSession(session: PampSession): Promise<void> {
    await ensurePampDirs();
    const dir = await pampDir();
    await writeJson(path.join(dir, 'sessions', `${session.agreementId}.json`), session);
}

export async function loadSession(agreementId: string): Promise<PampSession | null> {
    const dir = await pampDir();
    return readJson<PampSession>(path.join(dir, 'sessions', `${agreementId}.json`));
}

export async function listSessions(): Promise<PampSession[]> {
    const dir = await pampDir();
    const files = await listJsonFiles(path.join(dir, 'sessions'));
    const sessions: PampSession[] = [];
    for (const file of files) {
        const session = await readJson<PampSession>(path.join(dir, 'sessions', file));
        if (session) sessions.push(session);
    }
    return sessions;
}

// ── Contacts ────────────────────────────────────────────────────────────────

export async function saveContact(contact: PampContact): Promise<void> {
    await ensurePampDirs();
    const dir = await pampDir();
    const mailboxId = contact.address.split('@')[0];
    await writeJson(path.join(dir, 'contacts', `${mailboxId}.json`), contact);
}

export async function loadContact(mailboxId: string): Promise<PampContact | null> {
    const dir = await pampDir();
    return readJson<PampContact>(path.join(dir, 'contacts', `${mailboxId}.json`));
}

export async function loadContactByAddress(address: string): Promise<PampContact | null> {
    const mailboxId = address.split('@')[0];
    return loadContact(mailboxId);
}

export async function listContacts(): Promise<PampContact[]> {
    const dir = await pampDir();
    const files = await listJsonFiles(path.join(dir, 'contacts'));
    const contacts: PampContact[] = [];
    for (const file of files) {
        const contact = await readJson<PampContact>(path.join(dir, 'contacts', file));
        if (contact) contacts.push(contact);
    }
    return contacts;
}

// ── Messages ────────────────────────────────────────────────────────────────

export async function saveMessage(message: PampMessage, folder: 'inbox' | 'sent'): Promise<void> {
    await ensurePampDirs();
    const dir = await pampDir();
    await writeJson(
        path.join(dir, folder, `${message.header.message_id}.json`),
        message,
    );
}

export async function loadMessage(messageId: string, folder: 'inbox' | 'sent'): Promise<PampMessage | null> {
    const dir = await pampDir();
    return readJson<PampMessage>(path.join(dir, folder, `${messageId}.json`));
}

export async function listMessages(folder: 'inbox' | 'sent'): Promise<PampMessage[]> {
    const dir = await pampDir();
    const files = await listJsonFiles(path.join(dir, folder));
    const messages: PampMessage[] = [];
    for (const file of files) {
        const msg = await readJson<PampMessage>(path.join(dir, folder, file));
        if (msg) messages.push(msg);
    }
    return messages;
}

export async function updateMessageReadAt(
    messageId: string,
    folder: 'inbox' | 'sent',
    readAt: string,
): Promise<void> {
    const msg = await loadMessage(messageId, folder);
    if (!msg) return;
    msg.header.read_at = readAt;
    await saveMessage(msg, folder);
}

// ── Threads ─────────────────────────────────────────────────────────────────

interface ThreadIndex {
    threadId: string;
    messageIds: string[];
}

export async function saveThread(threadId: string, messageIds: string[]): Promise<void> {
    await ensurePampDirs();
    const dir = await pampDir();
    await writeJson(path.join(dir, 'threads', `${threadId}.json`), {
        threadId,
        messageIds,
    });
}

export async function loadThread(threadId: string): Promise<string[] | null> {
    const dir = await pampDir();
    const thread = await readJson<ThreadIndex>(path.join(dir, 'threads', `${threadId}.json`));
    return thread?.messageIds ?? null;
}

export async function addToThread(threadId: string, messageId: string): Promise<void> {
    const existing = await loadThread(threadId) ?? [];
    if (!existing.includes(messageId)) {
        existing.push(messageId);
    }
    await saveThread(threadId, existing);
}
