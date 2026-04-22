// ─────────────────────────────────────────────────────────────────────────────
// Feral PAMP — Catalog Source
// ─────────────────────────────────────────────────────────────────────────────
import { createCatalogNode } from './catalog-node.js';
/**
 * Provides pre-configured CatalogNodes for the PAMP messaging module.
 */
export class PampCatalogSource {
    getCatalogNodes() {
        return [
            createCatalogNode({
                key: 'pamp_send',
                nodeCodeKey: 'pamp_send',
                name: 'PAMP Send Message',
                group: 'pamp',
                description: 'Send an encrypted PAMP message to another mailbox',
            }),
            createCatalogNode({
                key: 'pamp_check_inbox',
                nodeCodeKey: 'pamp_check_inbox',
                name: 'PAMP Check Inbox',
                group: 'pamp',
                description: 'Fetch message headers from the PAMP inbox',
            }),
            createCatalogNode({
                key: 'pamp_share_entity',
                nodeCodeKey: 'pamp_share_entity',
                name: 'PAMP Share Entity',
                group: 'pamp',
                description: 'Share a vault entity with another agent via PAMP',
            }),
            createCatalogNode({
                key: 'pamp_await_reply',
                nodeCodeKey: 'pamp_await_reply',
                name: 'PAMP Await Reply',
                group: 'pamp',
                description: 'Poll the inbox for a reply to a specific message',
            }),
        ];
    }
}
