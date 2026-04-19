// ─────────────────────────────────────────────────────────────────────────────
// PAMP — Types & Constants
// ─────────────────────────────────────────────────────────────────────────────


// ── Identity ────────────────────────────────────────────────────────────────

export interface PampIdentity {
    mailboxId: string;
    address: string;
    postOffice: string;
    apiKey: string;
    displayName: string;
    identityKeyPair: { publicKey: string; privateKey: string };
    registeredAt: string;
}

// ── Agreements ──────────────────────────────────────────────────────────────

export interface PampAgreement {
    agreementId: string;
    type: 'bilateral' | 'unilateral';
    initiator: string;
    responder: string;
    status: 'pending' | 'active' | 'revoked' | 'declined' | 'expired';
    permissions: { initiatorCanSend: boolean; responderCanSend: boolean };
    publicKeys?: { initiator: string; responder: string };
    createdAt: string;
    acceptedAt?: string;
}

// ── Sessions ────────────────────────────────────────────────────────────────

export interface PampSession {
    agreementId: string;
    contactAddress: string;
    exchangeKeyPair: { publicKey: string; privateKey: string };
    contactPublicKey: string;
    establishedAt: string;
}

// ── Contacts ────────────────────────────────────────────────────────────────

export interface PampContact {
    address: string;
    displayName?: string;
    identityPublicKey: string;
    agreementId: string;
}

// ── Messages ────────────────────────────────────────────────────────────────

export interface PampEnvelopeHeader {
    pamp: string;
    message_id: string;
    agreement_id: string;
    from: string;
    to: string;
    created_at: string;
    read_at: string | null;
    chain: string[];
    chain_hash: string;
    content_type: string;
    signature: string;
}

export interface PampMessage {
    header: PampEnvelopeHeader;
    body: string;
    fetchedAt?: string;
}

// ── API Response Types ──────────────────────────────────────────────────────

export interface PampApiSuccess<T> {
    ok: true;
    data: T;
}

export interface PampApiError {
    ok: false;
    error: {
        code: string;
        message: string;
        status: number;
        details?: Record<string, unknown>;
    };
}

export type PampApiResponse<T> = PampApiSuccess<T> | PampApiError;

// ── Constants ───────────────────────────────────────────────────────────────

export const PAMP_VERSION = '0.1.0';
export const PAMP_BODY_DELIMITER = '\n---PAMP-BODY---\n';
