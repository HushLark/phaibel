// ─────────────────────────────────────────────────────────────────────────────
// Chat Session Logger — structured JSONL logs per chat session
// ─────────────────────────────────────────────────────────────────────────────
//
// Each chat session gets its own file: {vault}/.phaibel/logs/<chatId>.log
// ─────────────────────────────────────────────────────────────────────────────
import { getPlatform } from '../platform/index.js';
import { getLogsDir } from '../paths.js';
/**
 * Generate a short chat ID like `chat-a3f2b1`.
 */
export function generateChatId() {
    return 'chat-' + getPlatform().generateId(6);
}
export class ChatLogger {
    logFile = null;
    initPromise = null;
    initFailed = false;
    _chatId;
    buffer = [];
    constructor(chatId) {
        this._chatId = chatId;
    }
    get chatId() {
        return this._chatId;
    }
    /**
     * Append a structured log entry. Lazily creates the log directory and file.
     */
    async log(type, data) {
        if (this.initFailed)
            return;
        if (!this.logFile) {
            if (!this.initPromise) {
                this.initPromise = this.init();
            }
            try {
                await this.initPromise;
            }
            catch {
                this.initFailed = true;
                return;
            }
        }
        const line = JSON.stringify({
            ts: new Date().toISOString(),
            type,
            data,
        });
        this.buffer.push(line);
        await this.flush();
    }
    /**
     * Flush buffer and close.
     */
    close() {
        // Fire-and-forget final flush
        if (this.buffer.length > 0 && this.logFile) {
            this.flush().catch(() => { });
        }
    }
    async flush() {
        if (this.buffer.length === 0 || !this.logFile)
            return;
        const { storage } = getPlatform();
        const lines = this.buffer.splice(0);
        try {
            // Read existing content and append
            let existing = '';
            try {
                existing = await storage.readFile(this.logFile);
            }
            catch { /* new file */ }
            await storage.writeFile(this.logFile, existing + lines.join('\n') + '\n');
        }
        catch {
            // Logging should never crash the app
        }
    }
    async init() {
        const { storage, paths } = getPlatform();
        const logsDir = await getLogsDir();
        await storage.mkdir(logsDir, { recursive: true });
        this.logFile = paths.join(logsDir, `${this._chatId}.log`);
    }
}
/**
 * Append a reaction entry to an existing chat log file.
 * Used when reactions arrive after the chat session is finished.
 */
export async function appendReaction(chatId, reaction, details) {
    const { storage, paths } = getPlatform();
    const logsDir = await getLogsDir();
    await storage.mkdir(logsDir, { recursive: true });
    const logFile = paths.join(logsDir, `${chatId}.log`);
    const line = JSON.stringify({
        ts: new Date().toISOString(),
        type: 'reaction',
        data: { reaction, details: details || null },
    });
    let existing = '';
    try {
        existing = await storage.readFile(logFile);
    }
    catch { /* new file */ }
    await storage.writeFile(logFile, existing + line + '\n');
}
/**
 * Append a judge evaluation entry to an existing chat log file.
 * Called fire-and-forget after each response synthesis.
 */
export async function appendJudgement(chatId, judgement) {
    const { storage, paths } = getPlatform();
    const logsDir = await getLogsDir();
    await storage.mkdir(logsDir, { recursive: true });
    const logFile = paths.join(logsDir, `${chatId}.log`);
    const line = JSON.stringify({
        ts: new Date().toISOString(),
        type: 'judge',
        data: judgement,
    });
    let existing = '';
    try {
        existing = await storage.readFile(logFile);
    }
    catch { /* new file */ }
    await storage.writeFile(logFile, existing + line + '\n');
}
