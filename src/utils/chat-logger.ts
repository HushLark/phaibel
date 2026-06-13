// ─────────────────────────────────────────────────────────────────────────────
// Chat Session Logger — structured JSONL logs per chat session
// ─────────────────────────────────────────────────────────────────────────────
//
// Each chat session gets its own file: {vault}/.phaibel/logs/<chatId>.log
// ─────────────────────────────────────────────────────────────────────────────

import { getPlatform } from '../platform/index.js';
import { getLogsDir } from '../paths.js';

export type ChatLogType =
    | 'start'
    | 'classify'
    | 'blocked'
    | 'intent'
    | 'context_manifest'
    | 'context_fetch'
    | 'node_selection'
    | 'process_match'
    | 'process_design'
    | 'process_result'
    | 'completion_check'
    | 'response'
    | 'summary'
    | 'error'
    | 'reaction'
    | 'judge';

/**
 * Generate a short chat ID like `chat-a3f2b1`.
 */
export function generateChatId(): string {
    return 'chat-' + getPlatform().generateId(6);
}

export class ChatLogger {
    private logFile: string | null = null;
    private initPromise: Promise<void> | null = null;
    private initFailed = false;
    private _chatId: string;
    private buffer: string[] = [];

    constructor(chatId: string) {
        this._chatId = chatId;
    }

    get chatId(): string {
        return this._chatId;
    }

    /**
     * Append a structured log entry. Lazily creates the log directory and file.
     */
    async log(type: ChatLogType, data: Record<string, unknown>): Promise<void> {
        if (this.initFailed) return;

        if (!this.logFile) {
            if (!this.initPromise) {
                this.initPromise = this.init();
            }
            try {
                await this.initPromise;
            } catch {
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
    close(): void {
        // Fire-and-forget final flush
        if (this.buffer.length > 0 && this.logFile) {
            this.flush().catch(() => {});
        }
    }

    private async flush(): Promise<void> {
        if (this.buffer.length === 0 || !this.logFile) return;
        const { storage } = getPlatform();
        const lines = this.buffer.splice(0);
        try {
            // Read existing content and append
            let existing = '';
            try { existing = await storage.readFile(this.logFile); } catch { /* new file */ }
            await storage.writeFile(this.logFile, existing + lines.join('\n') + '\n');
        } catch {
            // Logging should never crash the app
        }
    }

    private async init(): Promise<void> {
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
export async function appendReaction(
    chatId: string,
    reaction: 'positive' | 'negative',
    details?: string,
): Promise<void> {
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
    try { existing = await storage.readFile(logFile); } catch { /* new file */ }
    await storage.writeFile(logFile, existing + line + '\n');
}

/**
 * Append a judge evaluation entry to an existing chat log file.
 * Called fire-and-forget after each response synthesis.
 */
export async function appendJudgement(
    chatId: string,
    judgement: {
        achieved: boolean;
        confidence: number;
        reasoning: string;
    },
): Promise<void> {
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
    try { existing = await storage.readFile(logFile); } catch { /* new file */ }
    await storage.writeFile(logFile, existing + line + '\n');
}

/**
 * Delete chat log files older than `retentionDays` days.
 * Reads the first line of each `.log` file to get its timestamp.
 */
export async function pruneOldChatLogs(retentionDays: number): Promise<{ scanned: number; deleted: number }> {
    const { storage, paths } = getPlatform();
    const logsDir = await getLogsDir();
    let files: string[] = [];
    try {
        files = (await storage.readdir(logsDir)).filter((f: string) => f.endsWith('.log'));
    } catch {
        return { scanned: 0, deleted: 0 };
    }

    const cutoff = Date.now() - retentionDays * 86_400_000;
    let deleted = 0;
    for (const file of files) {
        const filePath = paths.join(logsDir, file);
        try {
            const raw = await storage.readFile(filePath);
            const firstLine = raw.split('\n')[0];
            if (!firstLine) continue;
            const entry = JSON.parse(firstLine) as { ts?: string };
            if (entry.ts && new Date(entry.ts).getTime() < cutoff) {
                await storage.unlink(filePath);
                deleted++;
            }
        } catch {
            // Skip unreadable or unparseable files
        }
    }
    return { scanned: files.length, deleted };
}
