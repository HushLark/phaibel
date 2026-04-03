// ─────────────────────────────────────────────────────────────────────────────
// Chat Session Logger — structured JSONL logs per chat session
// ─────────────────────────────────────────────────────────────────────────────
//
// Each chat session gets its own file: {vault}/.phaibel/logs/<chatId>.log
// ─────────────────────────────────────────────────────────────────────────────

import { createWriteStream, type WriteStream } from 'fs';
import { promises as fs } from 'fs';
import crypto from 'crypto';
import { getLogsDir } from '../paths.js';
import path from 'path';

export type ChatLogType =
    | 'start'
    | 'node_selection'
    | 'process_match'
    | 'process_design'
    | 'process_result'
    | 'completion_check'
    | 'response'
    | 'error'
    | 'reaction'
    | 'judge';

/**
 * Generate a short chat ID like `chat-a3f2b1`.
 */
export function generateChatId(): string {
    return 'chat-' + crypto.randomBytes(3).toString('hex');
}

export class ChatLogger {
    private stream: WriteStream | null = null;
    private initPromise: Promise<void> | null = null;
    private initFailed = false;
    private _chatId: string;

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

        if (!this.stream) {
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

        this.stream!.write(line + '\n');
    }

    /**
     * Flush and close the write stream.
     */
    close(): void {
        if (this.stream) {
            this.stream.end();
            this.stream = null;
        }
    }

    private async init(): Promise<void> {
        const logsDir = await getLogsDir();
        await fs.mkdir(logsDir, { recursive: true });
        const logFile = path.join(logsDir, `${this._chatId}.log`);
        this.stream = createWriteStream(logFile, { flags: 'a' });
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
    const logsDir = await getLogsDir();
    await fs.mkdir(logsDir, { recursive: true });
    const logFile = path.join(logsDir, `${chatId}.log`);
    const line = JSON.stringify({
        ts: new Date().toISOString(),
        type: 'reaction',
        data: { reaction, details: details || null },
    });
    await fs.appendFile(logFile, line + '\n');
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
    const logsDir = await getLogsDir();
    await fs.mkdir(logsDir, { recursive: true });
    const logFile = path.join(logsDir, `${chatId}.log`);
    const line = JSON.stringify({
        ts: new Date().toISOString(),
        type: 'judge',
        data: judgement,
    });
    await fs.appendFile(logFile, line + '\n');
}
