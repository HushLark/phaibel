// ─────────────────────────────────────────────────────────────────────────────
// PAMP — Cryptographic Operations
// ─────────────────────────────────────────────────────────────────────────────
//
// All crypto uses Node.js built-in `crypto` module:
//   - RSA-4096 for identity key signing/verification
//   - X25519 for session key exchange (ECDH)
//   - AES-256-GCM for message body encryption
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'crypto';

// ── ID Generation ───────────────────────────────────────────────────────────

const BASE36_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomBase36(length: number): string {
    const bytes = crypto.randomBytes(length);
    let result = '';
    for (let i = 0; i < length; i++) {
        result += BASE36_CHARS[bytes[i] % 36];
    }
    return result;
}

export function generateMailboxId(): string {
    return randomBase36(8);
}

export function generateMessageId(): string {
    return `msg-${randomBase36(8)}`;
}

export function generateAgreementId(): string {
    return `agr-${randomBase36(8)}`;
}

// ── Identity Key Pair (RSA-4096) ────────────────────────────────────────────

export function generateIdentityKeyPair(): { publicKey: string; privateKey: string } {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 4096,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return { publicKey, privateKey };
}

// ── Exchange Key Pair (X25519) ──────────────────────────────────────────────

export function generateExchangeKeyPair(): { publicKey: string; privateKey: string } {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
    const pubRaw = publicKey.export({ type: 'spki', format: 'der' });
    const privRaw = privateKey.export({ type: 'pkcs8', format: 'der' });
    return {
        publicKey: pubRaw.toString('base64'),
        privateKey: privRaw.toString('base64'),
    };
}

// ── Hybrid Encryption (X25519 + AES-256-GCM) ───────────────────────────────

export interface EncryptedPackage {
    encrypted_key: string;
    nonce: string;
    auth_tag: string;
    ciphertext: string;
}

export function encryptBody(
    plaintext: string,
    recipientPublicKeyBase64: string,
    senderPrivateKeyBase64: string,
): string {
    // Derive shared secret via X25519 ECDH
    const senderPrivate = crypto.createPrivateKey({
        key: Buffer.from(senderPrivateKeyBase64, 'base64'),
        format: 'der',
        type: 'pkcs8',
    });
    const recipientPublic = crypto.createPublicKey({
        key: Buffer.from(recipientPublicKeyBase64, 'base64'),
        format: 'der',
        type: 'spki',
    });
    const sharedSecret = crypto.diffieHellman({
        privateKey: senderPrivate,
        publicKey: recipientPublic,
    });

    // Derive AES key from shared secret using HKDF
    const aesKey = crypto.hkdfSync('sha256', sharedSecret, '', 'pamp-aes-key', 32);

    // AES-256-GCM encrypt
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(aesKey), nonce);
    const ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    const pkg: EncryptedPackage = {
        encrypted_key: '', // Not needed — key derived from ECDH shared secret
        nonce: nonce.toString('base64'),
        auth_tag: authTag.toString('base64'),
        ciphertext: ciphertext.toString('base64'),
    };

    return Buffer.from(JSON.stringify(pkg)).toString('base64');
}

export function decryptBody(
    encryptedPackageBase64: string,
    recipientPrivateKeyBase64: string,
    senderPublicKeyBase64: string,
): string {
    const pkg: EncryptedPackage = JSON.parse(
        Buffer.from(encryptedPackageBase64, 'base64').toString('utf8'),
    );

    // Derive shared secret via X25519 ECDH (reverse direction)
    const recipientPrivate = crypto.createPrivateKey({
        key: Buffer.from(recipientPrivateKeyBase64, 'base64'),
        format: 'der',
        type: 'pkcs8',
    });
    const senderPublic = crypto.createPublicKey({
        key: Buffer.from(senderPublicKeyBase64, 'base64'),
        format: 'der',
        type: 'spki',
    });
    const sharedSecret = crypto.diffieHellman({
        privateKey: recipientPrivate,
        publicKey: senderPublic,
    });

    // Derive same AES key
    const aesKey = crypto.hkdfSync('sha256', sharedSecret, '', 'pamp-aes-key', 32);

    // AES-256-GCM decrypt
    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        Buffer.from(aesKey),
        Buffer.from(pkg.nonce, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(pkg.auth_tag, 'base64'));

    const plaintext = Buffer.concat([
        decipher.update(Buffer.from(pkg.ciphertext, 'base64')),
        decipher.final(),
    ]);

    return plaintext.toString('utf8');
}

// ── RSA Signing / Verification ──────────────────────────────────────────────

export function signMessage(
    headerJson: string,
    bodyCiphertext: string,
    privateKeyPem: string,
): string {
    const payload = headerJson + bodyCiphertext;
    const sign = crypto.createSign('SHA256');
    sign.update(payload);
    sign.end();
    return sign.sign(privateKeyPem, 'base64');
}

export function verifySignature(
    headerJson: string,
    bodyCiphertext: string,
    signature: string,
    publicKeyPem: string,
): boolean {
    const payload = headerJson + bodyCiphertext;
    const verify = crypto.createVerify('SHA256');
    verify.update(payload);
    verify.end();
    return verify.verify(publicKeyPem, signature, 'base64');
}

// ── Chain Hash ──────────────────────────────────────────────────────────────

export function computeChainHash(chain: string[]): string {
    return crypto.createHash('sha256').update(chain.join('|')).digest('hex');
}
