// ─────────────────────────────────────────────────────────────────────────────
// Platform Abstraction — Node.js Implementation
// ─────────────────────────────────────────────────────────────────────────────
//
// Default platform provider for the CLI and service daemon.
// Delegates to Node.js built-ins: fs.promises, path, os, crypto.
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs, realpathSync } from 'fs';
import path from 'path';
import os from 'os';
import type { PlatformProvider, StorageProvider, PathProvider, SecretsProvider, FileStat } from './types.js';

// ── StorageProvider ─────────────────────────────────────────────────────────

class NodeStorageProvider implements StorageProvider {
    async readFile(filePath: string, encoding = 'utf-8'): Promise<string> {
        return fs.readFile(filePath, encoding as BufferEncoding);
    }

    async writeFile(filePath: string, content: string): Promise<void> {
        await fs.writeFile(filePath, content);
    }

    async readdir(dirPath: string): Promise<string[]> {
        return fs.readdir(dirPath);
    }

    async mkdir(dirPath: string, opts?: { recursive?: boolean }): Promise<void> {
        await fs.mkdir(dirPath, opts);
    }

    async rename(oldPath: string, newPath: string): Promise<void> {
        await fs.rename(oldPath, newPath);
    }

    async access(filePath: string): Promise<void> {
        await fs.access(filePath);
    }

    async unlink(filePath: string): Promise<void> {
        await fs.unlink(filePath);
    }

    async stat(filePath: string): Promise<FileStat> {
        const stats = await fs.stat(filePath);
        return {
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile(),
            mtime: stats.mtime,
            size: stats.size,
        };
    }

    async realpath(filePath: string): Promise<string> {
        return realpathSync(filePath);
    }
}

// ── PathProvider ────────────────────────────────────────────────────────────

const nodePathProvider: PathProvider = {
    join: (...parts: string[]) => path.join(...parts),
    basename: (p: string, ext?: string) => path.basename(p, ext),
    dirname: (p: string) => path.dirname(p),
    resolve: (...parts: string[]) => path.resolve(...parts),
    extname: (p: string) => path.extname(p),
    sep: path.sep,
};

// ── SecretsProvider ────────────────────────────────────────────────────────

class NodeSecretsProvider implements SecretsProvider {
    private secretsPath: string;

    constructor(systemDir: string) {
        this.secretsPath = path.join(systemDir, 'secrets.json');
    }

    async getApiKey(provider: string): Promise<string | null> {
        const all = await this.loadAll();
        return all[provider]?.apiKey ?? null;
    }

    async setApiKey(provider: string, key: string): Promise<void> {
        const all = await this.loadAll();
        all[provider] = { apiKey: key };
        const dir = path.dirname(this.secretsPath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(this.secretsPath, JSON.stringify({ providers: all }, null, 2));
    }

    async loadAll(): Promise<Record<string, { apiKey: string }>> {
        try {
            const data = await fs.readFile(this.secretsPath, 'utf-8');
            const parsed = JSON.parse(data);
            return parsed?.providers ?? {};
        } catch {
            return {};
        }
    }
}

// ── PlatformProvider ───────────────────────────────────────────────────────

class NodePlatformProvider implements PlatformProvider {
    readonly storage: StorageProvider;
    readonly paths: PathProvider;
    readonly secrets: SecretsProvider;

    private readonly _systemDir: string;

    constructor() {
        this._systemDir = path.join(os.homedir(), '.phaibel');
        this.storage = new NodeStorageProvider();
        this.paths = nodePathProvider;
        this.secrets = new NodeSecretsProvider(this._systemDir);
    }

    homedir(): string {
        return os.homedir();
    }

    systemDir(): string {
        return this._systemDir;
    }

    generateId(length: number): string {
        const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
        const alpha = 'abcdefghijklmnopqrstuvwxyz';
        let id = alpha[Math.floor(Math.random() * 26)];
        for (let i = 1; i < length; i++) {
            id += chars[Math.floor(Math.random() * 36)];
        }
        return id;
    }
}

/** Create a Node.js platform provider. */
export function createNodePlatform(): PlatformProvider {
    return new NodePlatformProvider();
}
