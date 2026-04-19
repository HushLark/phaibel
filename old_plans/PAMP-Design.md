# PAMP — Personal Assistant Message Protocol

> Design specification for inter-Phaibel messaging via a Post Office relay.

**Version:** 0.1.0-draft
**Status:** Design Phase

---

## 1. Overview

PAMP enables Phaibel instances to exchange encrypted messages through a shared **Post Office** server. Each Phaibel registers a **Mailbox**, establishes bilateral or unilateral **Agreements** with other mailboxes, and then sends/receives messages whose bodies are end-to-end encrypted — the Post Office can only read routing headers.

```mermaid
graph LR
    subgraph "Phaibel A (Alice)"
        A_Client[PAMP Client]
        A_Vault[(Local Vault<br/>~/.phaibel/pamp/)]
    end

    subgraph "Post Office"
        PO_API[REST API]
        PO_Store[(Message Store)]
        PO_Registry[(Mailbox Registry)]
    end

    subgraph "Phaibel B (Bob)"
        B_Client[PAMP Client]
        B_Vault[(Local Vault<br/>~/.phaibel/pamp/)]
    end

    A_Client -- "HTTPS" --> PO_API
    B_Client -- "HTTPS" --> PO_API
    PO_API --> PO_Store
    PO_API --> PO_Registry
    A_Client --> A_Vault
    B_Client --> B_Vault
```

---

## 2. Mailbox Identity

### 2.1 Mailbox ID Format

Each Phaibel registers a globally unique mailbox at a Post Office:

```
{MAILBOX_ID}@pamp.{postoffice_host}
```

| Component | Format | Example |
|-----------|--------|---------|
| `MAILBOX_ID` | 8 chars, uppercase base-36 `[A-Z0-9]` | `K7X2MQ4P` |
| `postoffice_host` | Domain of the Post Office | `relay.phaibel.dev` |
| **Full address** | Combined | `K7X2MQ4P@pamp.relay.phaibel.dev` |

- The Post Office **guarantees uniqueness** of the `MAILBOX_ID` within its registry.
- A Phaibel instance may hold **one mailbox per Post Office** (but may register at multiple Post Offices).

### 2.2 Mailbox Registration

```mermaid
sequenceDiagram
    participant D as Phaibel Client
    participant PO as Post Office

    D->>D: Generate RSA-4096 keypair (identity key)
    D->>PO: POST /mailbox/register<br/>{preferred_id?, public_key, display_name}
    PO->>PO: Validate ID uniqueness<br/>(or generate if not provided)
    PO->>PO: Generate API key (pamp_sk_...)
    PO-->>D: 201 {mailbox_id, address, api_key, registered_at}
    D->>D: Store credentials in ~/.phaibel/pamp/identity.json
    Note over D: API key is shown ONCE at registration.<br/>Client must store it securely.
```

**API key** — a secret token issued at registration, used to authenticate all subsequent API calls. Format: `pamp_sk_{32 random hex chars}` (e.g. `pamp_sk_a1b2c3d4e5f6...`). The key is returned **once** at registration and cannot be retrieved again — only rotated.

**Identity key** — long-lived RSA-4096 keypair used to:
1. **Sign** outgoing messages (prove sender authenticity)
2. **Verify** message integrity (recipient checks signature against sender's public key)

---

## 3. Agreements

Before two mailboxes can exchange messages, they must form an **Agreement**. This is PAMP's trust handshake.

### 3.1 Agreement Types

| Type | Description | A can send to B? | B can send to A? |
|------|-------------|:-:|:-:|
| **Bilateral** | Both parties agree to communicate | Yes | Yes |
| **Unilateral (A→B)** | A requests, B accepts receive-only | No | Yes |
| **Unilateral (B→A)** | B requests, A accepts receive-only | Yes | No |

> **Unilateral use case:** A notification service (e.g. a shared calendar Phaibel) broadcasts to subscribers who cannot reply.

### 3.2 Agreement Flow

```mermaid
sequenceDiagram
    participant A as Phaibel A (Initiator)
    participant PO as Post Office
    participant B as Phaibel B (Responder)

    Note over A: Wants to message B

    A->>A: Generate session keypair<br/>(X25519 for this agreement)
    A->>PO: POST /agreement/request<br/>{from: A, to: B, type: bilateral,<br/>public_key_a, expires_in: 72h}
    PO->>PO: Store pending agreement
    PO-->>A: 202 {agreement_id, status: pending}

    Note over PO: B polls or receives webhook

    B->>PO: GET /agreement/pending
    PO-->>B: [{agreement_id, from: A, type, public_key_a}]

    B->>B: Generate session keypair<br/>(X25519 for this agreement)
    B->>PO: POST /agreement/{id}/accept<br/>{public_key_b}
    PO->>PO: Mark agreement active,<br/>store both public keys
    PO-->>B: 200 {status: active}

    A->>PO: GET /agreement/{id}
    PO-->>A: {status: active, public_key_b}

    Note over A,B: Both sides now have each<br/>other's session public keys.<br/>Messages can flow.
```

### 3.3 Agreement Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Pending: request created
    Pending --> Active: responder accepts
    Pending --> Declined: responder declines
    Pending --> Expired: 72h timeout (configurable)
    Active --> Revoked: either party revokes
    Declined --> [*]
    Expired --> [*]
    Revoked --> [*]
```

- **Revocation** — either party can unilaterally revoke at any time. Outstanding messages remain readable but no new messages can be sent. Session keys are destroyed on the Post Office. This is permanent — to communicate again, a new agreement must be formed.
- **Key rotation** — either party may push a new session public key via `POST /agreement/{id}/rotate-key`. The old key remains valid for decrypting historical messages.

### 3.4 Agreement Record

```jsonc
{
  "agreement_id": "agr-5HN2KQ8M",
  "type": "bilateral",              // bilateral | unilateral
  "initiator": "K7X2MQ4P@pamp.relay.phaibel.dev",
  "responder": "R3TW9YAL@pamp.relay.phaibel.dev",
  "status": "active",
  "permissions": {
    "initiator_can_send": true,
    "responder_can_send": true
  },
  "public_keys": {
    "initiator": "<base64-encoded X25519 public key>",
    "responder": "<base64-encoded X25519 public key>"
  },
  "created_at": "2026-03-09T14:30:00Z",
  "accepted_at": "2026-03-09T15:12:00Z",
  "expires_at": null               // null = no expiry
}
```

---

## 4. Message Format

### 4.1 Wire Format

Messages are transmitted and stored as **Base64-encoded** blobs. When decoded, a message has two sections: a **plaintext header** (JSON) and an **encrypted body**.

```
┌─────────────────────────────────────────────┐
│              Base64 Envelope                │
│  ┌───────────────────────────────────────┐  │
│  │         Header (plaintext JSON)       │  │
│  │  version, message_id, chain,          │  │
│  │  from, to, created, read_at,          │  │
│  │  content_type, agreement_id           │  │
│  ├───────────────────────────────────────┤  │
│  │  \n---PAMP-BODY---\n  (delimiter)     │  │
│  ├───────────────────────────────────────┤  │
│  │      Body (encrypted + base64)        │  │
│  │  Encrypted with recipient's           │  │
│  │  session public key (X25519 + AES)    │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

### 4.2 Header Schema

```jsonc
{
  "pamp": "0.1.0",                           // protocol version
  "message_id": "msg-7KW3NP2X",             // unique, 8-char base36 prefixed
  "agreement_id": "agr-5HN2KQ8M",           // which agreement authorizes this
  "from": "K7X2MQ4P@pamp.relay.phaibel.dev",
  "to": "R3TW9YAL@pamp.relay.phaibel.dev",
  "created_at": "2026-03-09T16:00:00Z",
  "read_at": null,                           // set when recipient reads
  "chain": [],                               // message chain (see §5)
  "content_type": "text/plain",              // body content type
  "signature": "<base64 RSA signature>"      // sender signs header+body
}
```

**Content types:**

| `content_type` | Description |
|-----------------|-------------|
| `text/plain` | Plain text message |
| `text/markdown` | Markdown-formatted message |
| `application/json` | Structured data (entity shares, action requests) |
| `application/pamp-action` | Actionable request (see §7 — Enhancements) |

### 4.3 Body Encryption

```mermaid
graph LR
    subgraph "Sender (Phaibel A)"
        PT[Plaintext Body] --> AES[AES-256-GCM Encrypt]
        RK[Random AES Key] --> AES
        RK --> EK[X25519 Encrypt<br/>with B's public key]
    end

    AES --> |ciphertext| PKG[Encrypted Package]
    EK --> |encrypted key| PKG

    subgraph "Encrypted Package (in body field)"
        PKG --> B64[Base64 Encode]
    end

    subgraph "Recipient (Phaibel B)"
        B64 --> DK[X25519 Decrypt<br/>with B's private key]
        DK --> AES_KEY[Recovered AES Key]
        B64 --> DAES[AES-256-GCM Decrypt]
        AES_KEY --> DAES
        DAES --> PT2[Plaintext Body]
    end
```

**Hybrid encryption scheme (X25519 + AES-256-GCM):**

1. Sender generates a random 256-bit AES key
2. Sender encrypts the body with AES-256-GCM (produces ciphertext + nonce + auth tag)
3. Sender encrypts the AES key with the recipient's X25519 public key
4. Package: `{ encrypted_key, nonce, auth_tag, ciphertext }` → Base64

**Signature:** The sender signs `SHA-256(header_json + body_ciphertext)` with their RSA identity key. The recipient (and the Post Office for abuse prevention) can verify the signature using the sender's registered public identity key.

---

## 5. Message Chains (Thread Linking)

Messages form chains similar to blockchain linking — each reply references the full ancestry, giving both sides complete conversational context.

### 5.1 Chain Structure

```mermaid
graph LR
    M1["msg-AAAA1111<br/>chain: []<br/>(original)"]
    M2["msg-BBBB2222<br/>chain: [msg-AAAA1111]<br/>(reply)"]
    M3["msg-CCCC3333<br/>chain: [msg-AAAA1111,<br/>msg-BBBB2222]<br/>(reply to reply)"]
    M4["msg-DDDD4444<br/>chain: [msg-AAAA1111,<br/>msg-BBBB2222,<br/>msg-CCCC3333]"]

    M1 --> M2 --> M3 --> M4

    style M1 fill:#e1f5fe
    style M2 fill:#e8f5e9
    style M3 fill:#fff3e0
    style M4 fill:#fce4ec
```

### 5.2 Chain Rules

1. A new conversation starts with `chain: []`
2. A reply copies the parent's chain and appends the parent's `message_id`
3. The chain is an **ordered array** — position = sequence in conversation
4. Each Phaibel stores the **full decrypted messages locally** so the chain IDs serve as references to reconstruct the full thread from local storage
5. The **chain hash** (`SHA-256` of the concatenated chain IDs) is included in the header for integrity verification — if any message in the chain is tampered with or missing, the hash won't match

```jsonc
// Message 3 in a thread
{
  "message_id": "msg-CCCC3333",
  "chain": ["msg-AAAA1111", "msg-BBBB2222"],
  "chain_hash": "a1b2c3d4..."   // SHA-256 of "msg-AAAA1111|msg-BBBB2222"
}
```

---

## 6. Post Office Server

### 6.1 Responsibilities

```mermaid
graph TD
    subgraph "Post Office"
        API[REST API Gateway]
        AUTH[Auth & Rate Limiting]
        REG[Mailbox Registry]
        AGR[Agreement Manager]
        STORE[Message Store]
        REAPER[TTL Reaper<br/>&#40;cron&#41;]
        WEBHOOK[Webhook Dispatcher]
    end

    API --> AUTH --> REG
    API --> AUTH --> AGR
    API --> AUTH --> STORE
    REAPER -->|purge expired| STORE
    STORE -->|new message event| WEBHOOK
```

### 6.2 API Surface

| Method | Endpoint | Description |
|--------|----------|-------------|
| **Mailbox** | | |
| `POST` | `/mailbox/register` | Register a new mailbox |
| `GET` | `/mailbox/{id}` | Get mailbox public info (display name, public identity key) |
| `DELETE` | `/mailbox/{id}` | Deregister (requires auth) |
| `POST` | `/mailbox/{id}/rotate-api-key` | Rotate API key (returns new key, invalidates old) |
| **Agreements** | | |
| `POST` | `/agreement/request` | Initiate an agreement |
| `GET` | `/agreement/pending` | List pending agreements for authed mailbox |
| `POST` | `/agreement/{id}/accept` | Accept with public key |
| `POST` | `/agreement/{id}/decline` | Decline |
| `POST` | `/agreement/{id}/revoke` | Permanently revoke an agreement |
| `POST` | `/agreement/{id}/rotate-key` | Push a new session public key |
| `GET` | `/agreement/{id}` | Get agreement details |
| **Messages** | | |
| `POST` | `/message/send` | Send a message (Base64 envelope) |
| `GET` | `/mailbox/{id}/messages` | List messages (headers only) |
| `GET` | `/message/{msg_id}` | Fetch full message (marks read) |
| `POST` | `/message/{msg_id}/read` | Explicit read receipt |
| `GET` | `/mailbox/{id}/threads` | List threads (grouped by chain root) |

### 6.3 API Response Envelope

All Post Office API responses use a standard envelope. Successful responses vary by endpoint, but **every error** uses the same shape.

#### Success Response

```jsonc
{
  "ok": true,
  "data": { /* endpoint-specific payload */ }
}
```

#### Error Response

```jsonc
{
  "ok": false,
  "error": {
    "code": "AGREEMENT_NOT_FOUND",          // machine-readable, UPPER_SNAKE_CASE
    "message": "No agreement found with id agr-ZZZZZZZZ.",  // human-readable
    "status": 404,                           // mirrors HTTP status code
    "details": {}                            // optional — extra context (see below)
  }
}
```

#### Error Codes

| Code | HTTP | Description |
|------|:----:|-------------|
| **Auth & Identity** | | |
| `AUTH_REQUIRED` | 401 | Missing `Authorization` header |
| `AUTH_INVALID` | 401 | API key does not match any mailbox |
| `AUTH_RATE_LIMITED` | 429 | Too many failed auth attempts |
| `MAILBOX_NOT_FOUND` | 404 | Mailbox ID does not exist |
| `MAILBOX_ALREADY_EXISTS` | 409 | Requested mailbox ID is taken |
| **Agreements** | | |
| `AGREEMENT_NOT_FOUND` | 404 | Agreement ID does not exist |
| `AGREEMENT_PENDING` | 409 | Agreement exists but hasn't been accepted yet |
| `AGREEMENT_REVOKED` | 410 | Agreement was revoked — cannot send or modify |
| `AGREEMENT_EXPIRED` | 410 | Agreement request expired before acceptance |
| `AGREEMENT_DECLINED` | 410 | Agreement was declined by responder |
| `AGREEMENT_DUPLICATE` | 409 | An active agreement already exists between these mailboxes |
| `AGREEMENT_SELF` | 422 | Cannot create an agreement with yourself |
| **Messages** | | |
| `MESSAGE_NOT_FOUND` | 404 | Message ID does not exist or has been purged |
| `MESSAGE_UNAUTHORIZED` | 403 | Caller is not the sender or recipient of this message |
| `SEND_NOT_PERMITTED` | 403 | Agreement does not permit this direction of messaging |
| `CHAIN_MISMATCH` | 422 | Chain hash does not match the referenced message IDs |
| `SIGNATURE_INVALID` | 422 | Message signature verification failed |
| `ENVELOPE_MALFORMED` | 400 | Base64 envelope could not be decoded or parsed |
| **General** | | |
| `VALIDATION_ERROR` | 400 | Request body failed schema validation |
| `RATE_LIMITED` | 429 | Too many requests — try again later |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

#### Error `details` Field

The `details` object carries structured context depending on the error code:

```jsonc
// VALIDATION_ERROR — which fields failed
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "status": 400,
    "details": {
      "fields": [
        { "field": "to", "reason": "Invalid mailbox address format." },
        { "field": "content_type", "reason": "Must be one of: text/plain, text/markdown, application/json, application/pamp-action." }
      ]
    }
  }
}

// RATE_LIMITED — when the client can retry
{
  "ok": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded.",
    "status": 429,
    "details": {
      "retry_after_seconds": 42,
      "limit": 100,
      "window": "1h"
    }
  }
}

// AGREEMENT_REVOKED — who revoked and when
{
  "ok": false,
  "error": {
    "code": "AGREEMENT_REVOKED",
    "message": "Agreement agr-5HN2KQ8M has been revoked.",
    "status": 410,
    "details": {
      "agreement_id": "agr-5HN2KQ8M",
      "revoked_by": "K7X2MQ4P@pamp.relay.phaibel.dev",
      "revoked_at": "2026-03-09T18:00:00Z"
    }
  }
}
```

#### HTTP Headers on Error

| Header | Value | Purpose |
|--------|-------|---------|
| `PAMP-Request-Id` | `req-{uuid}` | Unique request ID for tracing/support |
| `Retry-After` | seconds | Present on 429 responses |

---

### 6.4 Message Retention

```mermaid
graph LR
    subgraph "TTL Policy"
        MSG[Message Stored] -->|"last activity<br/>on chain"| TIMER[7-Day TTL Timer]
        TIMER -->|"new message<br/>in chain"| RESET[Timer Reset]
        TIMER -->|"7 days<br/>no activity"| PURGE[Purge from<br/>Post Office]
    end
```

- **TTL starts** from the `created_at` of the most recent message in a chain
- **Any new message** in the chain resets the TTL for **all messages** in that chain
- **Read receipts** do NOT reset TTL (only new messages do)
- Clients are responsible for **local archival** — the Post Office is a relay, not permanent storage
- The reaper runs every hour and purges expired chains

### 6.5 Authentication

Every API call (except `/mailbox/register`) is authenticated with an **API key** plus a **mailbox identifier**:

```
Authorization: Bearer pamp_sk_a1b2c3d4e5f6...
PAMP-Mailbox: K7X2MQ4P
```

| Header | Purpose |
|--------|---------|
| `Authorization: Bearer {api_key}` | Proves the caller owns the mailbox (secret shared between client & Post Office) |
| `PAMP-Mailbox: {mailbox_id}` | Identifies which mailbox is making the request |

**API key lifecycle:**

| Endpoint | Description |
|----------|-------------|
| `POST /mailbox/register` | **No auth required** — returns the API key (shown once) |
| `POST /mailbox/{id}/rotate-api-key` | Invalidates the current key, returns a new one. Requires the current key to call. |

**Key format:** `pamp_sk_{32 hex chars}` — the `pamp_sk_` prefix makes it easy to identify in logs and secret scanners.

**Security notes:**
- API keys are stored **hashed** (SHA-256) on the Post Office — a database breach does not expose raw keys
- Keys are transmitted only over HTTPS
- The Post Office rate-limits failed auth attempts (5 failures → 15 min cooldown per IP)
- Message **signatures** (RSA identity key) remain separate — they prove message authenticity to the *recipient*, while API keys prove caller identity to the *Post Office*

---

## 7. Local Storage (Phaibel Client)

### 7.1 Vault Structure

```
~/.phaibel/
└── pamp/
    ├── identity.json           # Mailbox credentials & identity keypair
    ├── sessions/
    │   └── {agreement_id}.json # Session keypair per agreement
    ├── contacts/
    │   └── {mailbox_id}.json   # Known contacts (address, display name, public key)
    ├── inbox/
    │   └── {message_id}.json   # Received messages (decrypted locally)
    ├── sent/
    │   └── {message_id}.json   # Sent messages (plaintext copy)
    └── threads/
        └── {chain_root_id}.json # Thread index (ordered message IDs + metadata)
```

### 7.2 identity.json

```jsonc
{
  "mailbox_id": "K7X2MQ4P",
  "address": "K7X2MQ4P@pamp.relay.phaibel.dev",
  "post_office": "https://relay.phaibel.dev",
  "api_key": "pamp_sk_a1b2c3d4e5f67890abcdef1234567890",  // secret — never share
  "display_name": "Alice's Phaibel",
  "identity_keypair": {
    "public_key": "<base64 RSA-4096 public>",
    "private_key": "<base64 RSA-4096 private>"  // never leaves this file
  },
  "registered_at": "2026-03-09T14:30:00Z"
}
```

### 7.3 Stored Message Format

```jsonc
// ~/.phaibel/pamp/inbox/msg-BBBB2222.json
{
  "header": {
    "pamp": "0.1.0",
    "message_id": "msg-BBBB2222",
    "agreement_id": "agr-5HN2KQ8M",
    "from": "R3TW9YAL@pamp.relay.phaibel.dev",
    "to": "K7X2MQ4P@pamp.relay.phaibel.dev",
    "created_at": "2026-03-09T17:00:00Z",
    "read_at": "2026-03-09T17:05:00Z",
    "chain": ["msg-AAAA1111"],
    "chain_hash": "a1b2c3d4...",
    "content_type": "text/markdown",
    "signature": "<verified>"
  },
  "body": "Hey! Can you share the project timeline with me?",
  "fetched_at": "2026-03-09T17:05:00Z"
}
```

---

## 8. Full Message Lifecycle

```mermaid
sequenceDiagram
    participant A as Phaibel A (Sender)
    participant PO as Post Office
    participant B as Phaibel B (Recipient)

    Note over A,B: Agreement already active,<br/>keys exchanged

    A->>A: Compose plaintext body
    A->>A: Generate random AES-256 key
    A->>A: Encrypt body with AES-256-GCM
    A->>A: Encrypt AES key with B's X25519 public key
    A->>A: Build header (from, to, chain, etc.)
    A->>A: Sign header+ciphertext with RSA identity key
    A->>A: Assemble envelope → Base64
    A->>A: Store plaintext copy in sent/

    A->>PO: POST /message/send {base64_envelope}
    PO->>PO: Decode Base64, read header
    PO->>PO: Verify: agreement active?
    PO->>PO: Verify: sender authorized?
    PO->>PO: Verify: signature valid?
    PO->>PO: Store envelope, reset chain TTL
    PO-->>A: 201 {message_id, stored_at}

    Note over PO: B polls for new messages<br/>(or receives webhook)

    B->>PO: GET /mailbox/{id}/messages?unread=true
    PO-->>B: [{message_id, from, created_at, chain}]

    B->>PO: GET /message/{msg_id}
    PO->>PO: Set read_at timestamp
    PO-->>B: {base64_envelope}
    PO-->>A: Read receipt available via poll

    B->>B: Decode Base64
    B->>B: Verify signature with A's identity public key
    B->>B: Decrypt AES key with own X25519 private key
    B->>B: Decrypt body with AES-256-GCM
    B->>B: Store decrypted message in inbox/
    B->>B: Update thread index
```

---

## 9. Proposed Enhancements

These ideas extend PAMP beyond basic messaging. Each is optional and can be adopted independently.

### 9.1 Actionable Messages (`application/pamp-action`)

Let Phaibel instances send structured requests that the recipient can act on — turning messages into a lightweight RPC channel between personal assistants.

```jsonc
// Body (decrypted) of an action message
{
  "action": "share-entity",
  "payload": {
    "entity_type": "task",
    "entity": {
      "title": "Review Q2 budget",
      "status": "open",
      "priority": "high",
      "dueDate": "2026-03-15"
    }
  },
  "response_options": ["accept", "decline", "defer"]
}
```

**Use cases:**
- Share a task or event with another Phaibel (who can import it into their vault)
- Request availability for scheduling
- Delegate a task (sender's Phaibel asks recipient's Phaibel to create a todo)
- Poll — ask a yes/no question that auto-resolves

### 9.2 Presence & Polling Strategy

Instead of constant polling, support **long-poll** and **webhook** delivery:

| Strategy | How it works | Best for |
|----------|-------------|----------|
| **Poll** | `GET /mailbox/{id}/messages?since={timestamp}` | Simple clients, infrequent checks |
| **Long-poll** | Same endpoint with `?wait=30s` — server holds connection until new message or timeout | Near-real-time without WebSocket |
| **Webhook** | Post Office calls a registered URL on new message | Always-on Phaibel daemons |

### 9.3 Multi-Recipient Threads (Group Channels)

Extend agreements to support N-party groups:

- A **channel** is a named agreement among 2+ mailboxes
- Each member holds the channel's shared symmetric key (distributed via pairwise encryption)
- Messages specify `"to": "channel:{channel_id}"` instead of a single mailbox
- The Post Office fans out to all channel members

### 9.4 Message Priority & Urgency

Add optional header fields:

```jsonc
{
  "priority": "high",          // low | normal | high | urgent
  "expires_at": "2026-03-10T09:00:00Z"  // message becomes irrelevant after this
}
```

The receiving Phaibel can use priority to decide whether to interrupt the user or batch-deliver during a daily briefing.

### 9.5 Delivery Receipts (Beyond Read Receipts)

Track the full delivery lifecycle:

```
sent → stored → delivered → read
```

| Status | Meaning |
|--------|---------|
| `sent` | Sender submitted to Post Office |
| `stored` | Post Office accepted and stored |
| `delivered` | Recipient's client fetched the envelope |
| `read` | Recipient's client decrypted and presented to user/agent |

### 9.6 Spam & Abuse Prevention

- **Rate limiting** — Post Office enforces per-mailbox send limits (e.g. 100 messages/hour)
- **Agreement required** — no cold messaging; both parties must opt in
- **Reporting** — `POST /message/{id}/report` flags abuse; Post Office can revoke mailboxes
- **Proof of work** — optional: require a small computational proof with each message to throttle automated spam

### 9.7 Federation (Multi-Post-Office)

Two Post Offices can federate so `ALICE@pamp.relay-a.com` can message `BOB@pamp.relay-b.com`:

```mermaid
graph LR
    A[Phaibel A] -->|HTTPS| PO_A[Post Office A<br/>relay-a.com]
    PO_A -->|"Federation API<br/>(server-to-server)"| PO_B[Post Office B<br/>relay-b.com]
    PO_B -->|HTTPS| B[Phaibel B]
```

- Post Offices exchange server-level TLS certificates
- Agreement requests route through both Post Offices
- Messages relay through the sender's Post Office to the recipient's
- Each Post Office only stores messages for its own mailboxes

---

## 10. Security Summary

| Threat | Mitigation |
|--------|-----------|
| Post Office reads message bodies | End-to-end encryption (X25519 + AES-256-GCM) |
| Unauthorized API access | API key (`pamp_sk_...`) required on every call; keys hashed at rest on server |
| API key leak | `pamp_sk_` prefix for secret scanning; rotate via `/rotate-api-key`; rate-limited auth failures |
| Sender impersonation | RSA signature on every message, verified by recipient |
| Replay attacks | Message ID uniqueness enforced by Post Office |
| Unsolicited messages | Agreement required before messaging |
| Key compromise | Per-agreement session keys (limits blast radius), key rotation support |
| Message tampering | AES-GCM authentication tag + RSA signature |
| Chain tampering | Chain hash verifies conversation integrity |
| Metadata leakage | Headers are plaintext by design (routing need); future: onion-route through federation |
| Post Office DB breach | API keys stored as SHA-256 hashes; session private keys never leave client |

---

## 11. Phaibel Integration Points

### 11.1 CLI Commands

| Command | Description |
|---------|-------------|
| `phaibel pamp setup` | Register a mailbox at a Post Office |
| `phaibel pamp status` | Show mailbox info, active agreements, unread count |
| `phaibel pamp agree <address>` | Initiate an agreement |
| `phaibel pamp agreements` | List all agreements and their status |
| `phaibel pamp send <address> <message>` | Send a message (or reply with `--reply-to`) |
| `phaibel pamp inbox` | List received messages |
| `phaibel pamp read <msg_id>` | Read and decrypt a message |
| `phaibel pamp thread <msg_id>` | Show full conversation thread |

### 11.2 Feral Integration

PAMP operations map naturally to Feral NodeCodes:

| NodeCode | Purpose |
|----------|---------|
| `pamp_send_message` | Send a message within a process flow |
| `pamp_check_inbox` | Poll for new messages, output to context |
| `pamp_share_entity` | Send an entity to another Phaibel via action message |
| `pamp_await_reply` | Wait for a reply to a sent message (with timeout) |

### 11.3 Service Daemon Hook

The Phaibel daemon (`src/service/daemon.ts`) can register a **webhook** with the Post Office for real-time delivery, or run a periodic poll cron job (e.g. every 5 minutes) to fetch new messages.

---

## 12. Data Flow Summary

```mermaid
graph TB
    subgraph "Phaibel A"
        A1[User / Agent] -->|compose| A2[PAMP Client]
        A2 -->|encrypt + sign| A3[Base64 Envelope]
        A7[inbox/sent storage] --> A2
    end

    subgraph "Post Office"
        P1[API Gateway] -->|verify sig,<br/>check agreement| P2[Message Store]
        P3[TTL Reaper] -->|purge after 7d| P2
        P4[Webhook Dispatcher] -->|notify| B2
    end

    subgraph "Phaibel B"
        B2[PAMP Client] -->|decrypt + verify| B3[Plaintext Message]
        B3 --> B4[inbox storage]
        B3 --> B5[Thread Index]
        B3 -->|surface to| B1[User / Agent]
    end

    A3 -->|HTTPS POST| P1
    P2 -->|HTTPS GET or webhook| B2

    style A3 fill:#fff3e0
    style P2 fill:#e3f2fd
    style B3 fill:#e8f5e9
```

---

## Appendix A: Base64 Envelope Example

```
# Raw structure (before outer Base64 encoding):

{"pamp":"0.1.0","message_id":"msg-7KW3NP2X","agreement_id":"agr-5HN2KQ8M",
"from":"K7X2MQ4P@pamp.relay.phaibel.dev","to":"R3TW9YAL@pamp.relay.phaibel.dev",
"created_at":"2026-03-09T16:00:00Z","read_at":null,
"chain":[],"chain_hash":"e3b0c44298fc1c14...",
"content_type":"text/plain",
"signature":"MIIBIjANBgkqhki..."}
---PAMP-BODY---
eyJlbmNyeXB0ZWRfa2V5IjoiTUlJQ0lqQU5CZ2...
```

The entire block above is then Base64-encoded for transmission.

## Appendix B: Cryptographic Choices Rationale

| Choice | Why |
|--------|-----|
| **RSA-4096** for identity | Widely supported, long-lived keys, compatible with JWT ecosystem |
| **X25519** for session keys | Fast key exchange, small keys (32 bytes), modern and audited |
| **AES-256-GCM** for body | Authenticated encryption (integrity + confidentiality), hardware-accelerated on most platforms |
| **Hybrid encryption** | Asymmetric for key exchange, symmetric for bulk data — standard practice (like TLS) |
