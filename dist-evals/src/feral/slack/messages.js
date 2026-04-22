// ─────────────────────────────────────────────────────────────────────────────
// Feral Slack — Message Types
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Abstract base for all Slack message types.
 */
class AbstractMessage {
    channel;
    text;
    threadTs;
    blocks = [];
    addBlock(block) {
        if (this.blocks.length >= this.maxBlocks) {
            throw new Error(`Cannot add more than ${this.maxBlocks} blocks to this message.`);
        }
        this.blocks.push(block);
    }
    getBlocks() {
        return [...this.blocks];
    }
    toJSON() {
        const json = {};
        if (this.channel)
            json.channel = this.channel;
        if (this.text)
            json.text = this.text;
        if (this.threadTs)
            json.thread_ts = this.threadTs;
        if (this.blocks.length > 0) {
            json.blocks = this.blocks.map(b => b.toJSON());
        }
        return json;
    }
}
/**
 * Standard Slack message (max 50 blocks).
 */
export class Message extends AbstractMessage {
    maxBlocks = 50;
}
/**
 * Modal view message (max 100 blocks).
 */
export class ModalMessage extends AbstractMessage {
    maxBlocks = 100;
}
/**
 * Home tab view message (max 50 blocks).
 */
export class HomeTabMessage extends AbstractMessage {
    maxBlocks = 50;
}
