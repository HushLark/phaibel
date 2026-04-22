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
// ── StorageProvider ─────────────────────────────────────────────────────────
class NodeStorageProvider {
    async readFile(filePath, encoding = 'utf-8') {
        return fs.readFile(filePath, encoding);
    }
    async writeFile(filePath, content) {
        await fs.writeFile(filePath, content);
    }
    async readdir(dirPath) {
        return fs.readdir(dirPath);
    }
    async mkdir(dirPath, opts) {
        await fs.mkdir(dirPath, opts);
    }
    async rename(oldPath, newPath) {
        await fs.rename(oldPath, newPath);
    }
    async access(filePath) {
        await fs.access(filePath);
    }
    async unlink(filePath) {
        await fs.unlink(filePath);
    }
    async stat(filePath) {
        const stats = await fs.stat(filePath);
        return {
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile(),
            mtime: stats.mtime,
            size: stats.size,
        };
    }
    async realpath(filePath) {
        return realpathSync(filePath);
    }
}
// ── PathProvider ────────────────────────────────────────────────────────────
const nodePathProvider = {
    join: (...parts) => path.join(...parts),
    basename: (p, ext) => path.basename(p, ext),
    dirname: (p) => path.dirname(p),
    resolve: (...parts) => path.resolve(...parts),
    extname: (p) => path.extname(p),
    sep: path.sep,
};
// ── SecretsProvider ────────────────────────────────────────────────────────
class NodeSecretsProvider {
    secretsPath;
    constructor(systemDir) {
        this.secretsPath = path.join(systemDir, 'secrets.json');
    }
    async getApiKey(provider) {
        const all = await this.loadAll();
        return all[provider]?.apiKey ?? null;
    }
    async setApiKey(provider, key) {
        const all = await this.loadAll();
        all[provider] = { apiKey: key };
        const dir = path.dirname(this.secretsPath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(this.secretsPath, JSON.stringify({ providers: all }, null, 2));
    }
    async loadAll() {
        try {
            const data = await fs.readFile(this.secretsPath, 'utf-8');
            const parsed = JSON.parse(data);
            return parsed?.providers ?? {};
        }
        catch {
            return {};
        }
    }
}
// ── PlatformProvider ───────────────────────────────────────────────────────
class NodePlatformProvider {
    storage;
    paths;
    secrets;
    _systemDir;
    constructor() {
        this._systemDir = path.join(os.homedir(), '.phaibel');
        this.storage = new NodeStorageProvider();
        this.paths = nodePathProvider;
        this.secrets = new NodeSecretsProvider(this._systemDir);
    }
    homedir() {
        return os.homedir();
    }
    systemDir() {
        return this._systemDir;
    }
    generateId(length) {
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
export function createNodePlatform() {
    return new NodePlatformProvider();
}
