// ─────────────────────────────────────────────────────────────────────────────
// PAMP — Post Office REST API Client
// ─────────────────────────────────────────────────────────────────────────────
//
// Uses native fetch(). Handles API key auth, standard response envelope,
// and descriptive error messages.
// ─────────────────────────────────────────────────────────────────────────────

import type {
    PampIdentity,
    PampAgreement,
    PampEnvelopeHeader,
    PampApiResponse,
    PampMessage,
    PampSession,
    PampContact,
} from './types.js';
import { PAMP_VERSION } from './types.js';
import {
    generateIdentityKeyPair,
    generateExchangeKeyPair,
    generateMessageId,
    computeChainHash,
} from './crypto.js';
import { buildEnvelope, parseEnvelope, decryptEnvelope } from './envelope.js';
import {
    saveIdentity,
    saveSession,
    loadSession,
    saveContact,
    loadContactByAddress,
    saveMessage,
    addToThread,
} from './storage.js';

export class PampClient {
    constructor(private identity: PampIdentity) {}

    private headers(): Record<string, string> {
        return {
            'Authorization': `Bearer ${this.identity.apiKey}`,
            'PAMP-Mailbox': this.identity.mailboxId,
            'Content-Type': 'application/json',
        };
    }

    private url(path: string): string {
        return `${this.identity.postOffice}${path}`;
    }

    private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
        const init: RequestInit = {
            method,
            headers: this.headers(),
        };
        if (body !== undefined) {
            init.body = JSON.stringify(body);
        }

        const response = await fetch(this.url(path), init);
        const json = await response.json() as PampApiResponse<T>;

        if (!json.ok) {
            const err = json.error;
            throw new Error(`PAMP API error [${err.code}]: ${err.message}`);
        }
        return json.data;
    }

    // ── Mailbox ───────────────────────────────────────────────────────────

    /**
     * Register a new mailbox at a Post Office.
     * This is a static method — no identity needed yet.
     */
    static async register(
        postOffice: string,
        displayName: string,
        preferredId?: string,
    ): Promise<PampIdentity> {
        const identityKeyPair = generateIdentityKeyPair();

        const response = await fetch(`${postOffice}/mailbox/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                preferred_id: preferredId,
                public_key: identityKeyPair.publicKey,
                display_name: displayName,
            }),
        });

        const json = await response.json() as PampApiResponse<{
            mailbox_id: string;
            address: string;
            api_key: string;
            registered_at: string;
        }>;

        if (!json.ok) {
            throw new Error(`PAMP registration failed [${json.error.code}]: ${json.error.message}`);
        }

        const identity: PampIdentity = {
            mailboxId: json.data.mailbox_id,
            address: json.data.address,
            postOffice,
            apiKey: json.data.api_key,
            displayName,
            identityKeyPair,
            registeredAt: json.data.registered_at,
        };

        await saveIdentity(identity);
        return identity;
    }

    async getMailboxInfo(mailboxId: string): Promise<{
        mailbox_id: string;
        display_name: string;
        public_key: string;
    }> {
        return this.request('GET', `/mailbox/${mailboxId}`);
    }

    async rotateApiKey(): Promise<string> {
        const data = await this.request<{ api_key: string }>(
            'POST',
            `/mailbox/${this.identity.mailboxId}/rotate-api-key`,
        );
        this.identity.apiKey = data.api_key;
        await saveIdentity(this.identity);
        return data.api_key;
    }

    // ── Agreements ────────────────────────────────────────────────────────

    async requestAgreement(
        toAddress: string,
        type: 'bilateral' | 'unilateral' = 'bilateral',
    ): Promise<PampAgreement> {
        const exchangeKeyPair = generateExchangeKeyPair();

        const data = await this.request<{
            agreement_id: string;
            status: string;
        }>('POST', '/agreement/request', {
            from: this.identity.address,
            to: toAddress,
            type,
            public_key: exchangeKeyPair.publicKey,
        });

        const agreement: PampAgreement = {
            agreementId: data.agreement_id,
            type,
            initiator: this.identity.address,
            responder: toAddress,
            status: 'pending',
            permissions: {
                initiatorCanSend: type === 'bilateral',
                responderCanSend: true,
            },
            createdAt: new Date().toISOString(),
        };

        // Save session with our keypair (contact key not yet known)
        const session: PampSession = {
            agreementId: data.agreement_id,
            contactAddress: toAddress,
            exchangeKeyPair,
            contactPublicKey: '', // populated when agreement is accepted
            establishedAt: new Date().toISOString(),
        };
        await saveSession(session);

        // Fetch and save contact info
        const contactMailboxId = toAddress.split('@')[0];
        try {
            const info = await this.getMailboxInfo(contactMailboxId);
            await saveContact({
                address: toAddress,
                displayName: info.display_name,
                identityPublicKey: info.public_key,
                agreementId: data.agreement_id,
            });
        } catch {
            // Contact info will be populated later
            await saveContact({
                address: toAddress,
                identityPublicKey: '',
                agreementId: data.agreement_id,
            });
        }

        return agreement;
    }

    async listPendingAgreements(): Promise<PampAgreement[]> {
        const data = await this.request<Array<{
            agreement_id: string;
            type: 'bilateral' | 'unilateral';
            initiator: string;
            responder: string;
            status: string;
            permissions: { initiator_can_send: boolean; responder_can_send: boolean };
            public_keys?: { initiator: string; responder?: string };
            created_at: string;
        }>>('GET', '/agreement/pending');

        return data.map(a => ({
            agreementId: a.agreement_id,
            type: a.type,
            initiator: a.initiator,
            responder: a.responder,
            status: a.status as PampAgreement['status'],
            permissions: {
                initiatorCanSend: a.permissions.initiator_can_send,
                responderCanSend: a.permissions.responder_can_send,
            },
            publicKeys: a.public_keys ? {
                initiator: a.public_keys.initiator,
                responder: a.public_keys.responder ?? '',
            } : undefined,
            createdAt: a.created_at,
        }));
    }

    async acceptAgreement(agreementId: string): Promise<PampAgreement> {
        const exchangeKeyPair = generateExchangeKeyPair();

        const data = await this.request<{
            agreement_id: string;
            type: 'bilateral' | 'unilateral';
            initiator: string;
            responder: string;
            status: string;
            permissions: { initiator_can_send: boolean; responder_can_send: boolean };
            public_keys: { initiator: string; responder: string };
            created_at: string;
            accepted_at: string;
        }>('POST', `/agreement/${agreementId}/accept`, {
            public_key: exchangeKeyPair.publicKey,
        });

        // Save session with both keypairs
        const session: PampSession = {
            agreementId,
            contactAddress: data.initiator,
            exchangeKeyPair,
            contactPublicKey: data.public_keys.initiator,
            establishedAt: new Date().toISOString(),
        };
        await saveSession(session);

        // Save/update contact info
        const contactMailboxId = data.initiator.split('@')[0];
        try {
            const info = await this.getMailboxInfo(contactMailboxId);
            await saveContact({
                address: data.initiator,
                displayName: info.display_name,
                identityPublicKey: info.public_key,
                agreementId,
            });
        } catch {
            await saveContact({
                address: data.initiator,
                identityPublicKey: '',
                agreementId,
            });
        }

        return {
            agreementId: data.agreement_id,
            type: data.type,
            initiator: data.initiator,
            responder: data.responder,
            status: data.status as PampAgreement['status'],
            permissions: {
                initiatorCanSend: data.permissions.initiator_can_send,
                responderCanSend: data.permissions.responder_can_send,
            },
            publicKeys: data.public_keys,
            createdAt: data.created_at,
            acceptedAt: data.accepted_at,
        };
    }

    async declineAgreement(agreementId: string): Promise<void> {
        await this.request('POST', `/agreement/${agreementId}/decline`);
    }

    async revokeAgreement(agreementId: string): Promise<void> {
        await this.request('POST', `/agreement/${agreementId}/revoke`);
    }

    async getAgreement(agreementId: string): Promise<PampAgreement> {
        const data = await this.request<{
            agreement_id: string;
            type: 'bilateral' | 'unilateral';
            initiator: string;
            responder: string;
            status: string;
            permissions: { initiator_can_send: boolean; responder_can_send: boolean };
            public_keys?: { initiator: string; responder: string };
            created_at: string;
            accepted_at?: string;
        }>('GET', `/agreement/${agreementId}`);

        // If agreement is now active and we don't have the contact's public key,
        // update our session
        if (data.status === 'active' && data.public_keys) {
            const session = await loadSession(agreementId);
            if (session && !session.contactPublicKey) {
                session.contactPublicKey = data.public_keys.initiator === session.exchangeKeyPair.publicKey
                    ? data.public_keys.responder
                    : data.public_keys.initiator;
                await saveSession(session);
            }
        }

        return {
            agreementId: data.agreement_id,
            type: data.type,
            initiator: data.initiator,
            responder: data.responder,
            status: data.status as PampAgreement['status'],
            permissions: {
                initiatorCanSend: data.permissions.initiator_can_send,
                responderCanSend: data.permissions.responder_can_send,
            },
            publicKeys: data.public_keys,
            createdAt: data.created_at,
            acceptedAt: data.accepted_at,
        };
    }

    // ── Messages ──────────────────────────────────────────────────────────

    async sendMessage(
        toAddress: string,
        body: string,
        contentType = 'text/plain',
        replyToId?: string,
    ): Promise<PampMessage> {
        // Find the contact and session for this address
        const contact = await loadContactByAddress(toAddress);
        if (!contact) {
            throw new Error(`No contact found for ${toAddress}. Create an agreement first.`);
        }

        const session = await loadSession(contact.agreementId);
        if (!session) {
            throw new Error(`No session found for agreement ${contact.agreementId}.`);
        }
        if (!session.contactPublicKey) {
            throw new Error(`Agreement ${contact.agreementId} is not yet active — contact has not accepted.`);
        }

        // Build chain
        const chain: string[] = [];
        if (replyToId) {
            // TODO: load the parent message and copy its chain + append its ID
            chain.push(replyToId);
        }

        const messageId = generateMessageId();
        const now = new Date().toISOString();
        const chainHash = computeChainHash(chain);

        const header: Omit<PampEnvelopeHeader, 'signature'> = {
            pamp: PAMP_VERSION,
            message_id: messageId,
            agreement_id: contact.agreementId,
            from: this.identity.address,
            to: toAddress,
            created_at: now,
            read_at: null,
            chain,
            chain_hash: chainHash,
            content_type: contentType,
        };

        // Build the encrypted envelope
        const envelope = buildEnvelope(body, header, session, this.identity);

        // Send to Post Office
        await this.request('POST', '/message/send', {
            envelope,
        });

        // Build the full message for local storage
        const message: PampMessage = {
            header: { ...header, signature: '(local)' },
            body,
            fetchedAt: now,
        };

        // Save locally
        await saveMessage(message, 'sent');

        // Update thread index
        const threadRoot = chain.length > 0 ? chain[0] : messageId;
        await addToThread(threadRoot, messageId);

        return message;
    }

    async listMessages(options?: { unread?: boolean }): Promise<PampEnvelopeHeader[]> {
        const query = options?.unread ? '?unread=true' : '';
        return this.request('GET', `/mailbox/${this.identity.mailboxId}/messages${query}`);
    }

    async fetchMessage(messageId: string): Promise<string> {
        return this.request('GET', `/message/${messageId}`);
    }

    async fetchAndDecryptMessage(messageId: string): Promise<PampMessage> {
        // Fetch the base64 envelope from Post Office
        const base64Envelope = await this.fetchMessage(messageId);

        // Parse the envelope
        const { header, encryptedBody } = parseEnvelope(base64Envelope);

        // Load session for this agreement
        const session = await loadSession(header.agreement_id);
        if (!session) {
            throw new Error(`No session found for agreement ${header.agreement_id}.`);
        }

        // Load sender's identity public key for signature verification
        const senderMailboxId = header.from.split('@')[0];
        const contact = await loadContactByAddress(header.from);
        let senderPublicKey = contact?.identityPublicKey;

        if (!senderPublicKey) {
            // Fetch from Post Office
            const info = await this.getMailboxInfo(senderMailboxId);
            senderPublicKey = info.public_key;
            if (contact) {
                await saveContact({ ...contact, identityPublicKey: senderPublicKey });
            }
        }

        // Decrypt and verify
        const message = decryptEnvelope(header, encryptedBody, session, senderPublicKey);

        // Save locally
        await saveMessage(message, 'inbox');

        // Update thread index
        const threadRoot = message.header.chain.length > 0
            ? message.header.chain[0]
            : message.header.message_id;
        await addToThread(threadRoot, message.header.message_id);

        return message;
    }

    async markRead(messageId: string): Promise<void> {
        await this.request('POST', `/message/${messageId}/read`);
    }

    async listThreads(): Promise<Array<{
        thread_id: string;
        message_count: number;
        latest_message_id: string;
        latest_created_at: string;
    }>> {
        return this.request('GET', `/mailbox/${this.identity.mailboxId}/threads`);
    }
}
