// ─────────────────────────────────────────────────────────────────────────────
// PAMP — Envelope Wire Format
// ─────────────────────────────────────────────────────────────────────────────
//
// Handles encoding/decoding of Base64 PAMP envelopes:
//   Header (JSON) + delimiter + Encrypted Body → Base64
// ─────────────────────────────────────────────────────────────────────────────

import type { PampEnvelopeHeader, PampIdentity, PampMessage, PampSession } from './types.js';
import { PAMP_BODY_DELIMITER } from './types.js';
import { encryptBody, decryptBody, signMessage, verifySignature } from './crypto.js';

/**
 * Build a full Base64-encoded PAMP envelope.
 *
 * 1. Encrypts the body using session keys
 * 2. Signs header + ciphertext with identity RSA key
 * 3. Assembles header JSON + delimiter + encrypted body
 * 4. Base64-encodes the whole thing
 */
export function buildEnvelope(
    body: string,
    header: Omit<PampEnvelopeHeader, 'signature'>,
    session: PampSession,
    identity: PampIdentity,
): string {
    // Encrypt the body using X25519 session keys
    const encryptedBody = encryptBody(
        body,
        session.contactPublicKey,
        session.exchangeKeyPair.privateKey,
    );

    // Build header JSON without signature for signing
    const headerForSigning = JSON.stringify(header);

    // Sign header + encrypted body with RSA identity key
    const signature = signMessage(
        headerForSigning,
        encryptedBody,
        identity.identityKeyPair.privateKey,
    );

    // Add signature to header
    const fullHeader: PampEnvelopeHeader = { ...header, signature };
    const fullHeaderJson = JSON.stringify(fullHeader);

    // Assemble: header + delimiter + encrypted body → Base64
    const raw = fullHeaderJson + PAMP_BODY_DELIMITER + encryptedBody;
    return Buffer.from(raw).toString('base64');
}

/**
 * Parse a Base64 envelope into header + encrypted body.
 * Does NOT decrypt or verify — call decryptEnvelope() for that.
 */
export function parseEnvelope(base64Envelope: string): {
    header: PampEnvelopeHeader;
    encryptedBody: string;
} {
    const raw = Buffer.from(base64Envelope, 'base64').toString('utf8');
    const delimiterIndex = raw.indexOf(PAMP_BODY_DELIMITER);
    if (delimiterIndex === -1) {
        throw new Error('Invalid PAMP envelope: missing body delimiter');
    }

    const headerJson = raw.substring(0, delimiterIndex);
    const encryptedBody = raw.substring(delimiterIndex + PAMP_BODY_DELIMITER.length);

    const header = JSON.parse(headerJson) as PampEnvelopeHeader;
    return { header, encryptedBody };
}

/**
 * Verify signature and decrypt the body of a parsed envelope.
 */
export function decryptEnvelope(
    header: PampEnvelopeHeader,
    encryptedBody: string,
    session: PampSession,
    senderIdentityPublicKey: string,
): PampMessage {
    // Rebuild the header without signature for verification
    const { signature, ...headerWithoutSig } = header;
    const headerForVerification = JSON.stringify(headerWithoutSig);

    // Verify RSA signature
    const valid = verifySignature(
        headerForVerification,
        encryptedBody,
        signature,
        senderIdentityPublicKey,
    );
    if (!valid) {
        throw new Error(`PAMP signature verification failed for message ${header.message_id}`);
    }

    // Decrypt body using X25519 session keys
    const body = decryptBody(
        encryptedBody,
        session.exchangeKeyPair.privateKey,
        session.contactPublicKey,
    );

    return {
        header,
        body,
        fetchedAt: new Date().toISOString(),
    };
}
