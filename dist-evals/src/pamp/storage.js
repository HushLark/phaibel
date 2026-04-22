// ─────────────────────────────────────────────────────────────────────────────
// PAMP — Local Storage
// ─────────────────────────────────────────────────────────────────────────────
//
// Manages {vault}/.phaibel/pamp/ directory structure:
//   identity.json, sessions/, contacts/, inbox/, sent/, threads/
// ─────────────────────────────────────────────────────────────────────────────
import { promises as fs } from 'fs';
import path from 'path';
import { getPampDir } from '../paths.js';
// ── Directory Setup ─────────────────────────────────────────────────────────
const SUBDIRS = ['sessions', 'contacts', 'inbox', 'sent', 'threads'];
let _resolvedDir = null;
async function pampDir() {
    if (!_resolvedDir) {
        _resolvedDir = await getPampDir();
    }
    return _resolvedDir;
}
export async function ensurePampDirs() {
    const dir = await pampDir();
    for (const sub of SUBDIRS) {
        await fs.mkdir(path.join(dir, sub), { recursive: true });
    }
}
// ── Helpers ─────────────────────────────────────────────────────────────────
async function readJson(filePath) {
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data);
    }
    catch {
        return null;
    }
}
async function writeJson(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}
async function listJsonFiles(dir) {
    try {
        const entries = await fs.readdir(dir);
        return entries.filter(e => e.endsWith('.json'));
    }
    catch {
        return [];
    }
}
// ── Identity ────────────────────────────────────────────────────────────────
export async function saveIdentity(identity) {
    await ensurePampDirs();
    const dir = await pampDir();
    await writeJson(path.join(dir, 'identity.json'), identity);
}
export async function loadIdentity() {
    const dir = await pampDir();
    return readJson(path.join(dir, 'identity.json'));
}
export async function requireIdentity() {
    const identity = await loadIdentity();
    if (!identity) {
        throw new Error('PAMP not set up. Run `phaibel pamp setup` first.');
    }
    return identity;
}
// ── Sessions ────────────────────────────────────────────────────────────────
export async function saveSession(session) {
    await ensurePampDirs();
    const dir = await pampDir();
    await writeJson(path.join(dir, 'sessions', `${session.agreementId}.json`), session);
}
export async function loadSession(agreementId) {
    const dir = await pampDir();
    return readJson(path.join(dir, 'sessions', `${agreementId}.json`));
}
export async function listSessions() {
    const dir = await pampDir();
    const files = await listJsonFiles(path.join(dir, 'sessions'));
    const sessions = [];
    for (const file of files) {
        const session = await readJson(path.join(dir, 'sessions', file));
        if (session)
            sessions.push(session);
    }
    return sessions;
}
// ── Contacts ────────────────────────────────────────────────────────────────
export async function saveContact(contact) {
    await ensurePampDirs();
    const dir = await pampDir();
    const mailboxId = contact.address.split('@')[0];
    await writeJson(path.join(dir, 'contacts', `${mailboxId}.json`), contact);
}
export async function loadContact(mailboxId) {
    const dir = await pampDir();
    return readJson(path.join(dir, 'contacts', `${mailboxId}.json`));
}
export async function loadContactByAddress(address) {
    const mailboxId = address.split('@')[0];
    return loadContact(mailboxId);
}
export async function listContacts() {
    const dir = await pampDir();
    const files = await listJsonFiles(path.join(dir, 'contacts'));
    const contacts = [];
    for (const file of files) {
        const contact = await readJson(path.join(dir, 'contacts', file));
        if (contact)
            contacts.push(contact);
    }
    return contacts;
}
// ── Messages ────────────────────────────────────────────────────────────────
export async function saveMessage(message, folder) {
    await ensurePampDirs();
    const dir = await pampDir();
    await writeJson(path.join(dir, folder, `${message.header.message_id}.json`), message);
}
export async function loadMessage(messageId, folder) {
    const dir = await pampDir();
    return readJson(path.join(dir, folder, `${messageId}.json`));
}
export async function listMessages(folder) {
    const dir = await pampDir();
    const files = await listJsonFiles(path.join(dir, folder));
    const messages = [];
    for (const file of files) {
        const msg = await readJson(path.join(dir, folder, file));
        if (msg)
            messages.push(msg);
    }
    return messages;
}
export async function updateMessageReadAt(messageId, folder, readAt) {
    const msg = await loadMessage(messageId, folder);
    if (!msg)
        return;
    msg.header.read_at = readAt;
    await saveMessage(msg, folder);
}
export async function saveThread(threadId, messageIds) {
    await ensurePampDirs();
    const dir = await pampDir();
    await writeJson(path.join(dir, 'threads', `${threadId}.json`), {
        threadId,
        messageIds,
    });
}
export async function loadThread(threadId) {
    const dir = await pampDir();
    const thread = await readJson(path.join(dir, 'threads', `${threadId}.json`));
    return thread?.messageIds ?? null;
}
export async function addToThread(threadId, messageId) {
    const existing = await loadThread(threadId) ?? [];
    if (!existing.includes(messageId)) {
        existing.push(messageId);
    }
    await saveThread(threadId, existing);
}
