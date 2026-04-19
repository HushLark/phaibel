// ─────────────────────────────────────────────────────────────────────────────
// Platform Abstraction — Type Definitions
// ─────────────────────────────────────────────────────────────────────────────
//
// These interfaces decouple the Phaibel core from Node.js-specific APIs
// (fs, path, os, crypto) so the same code can run on:
//   - Node.js (CLI + service daemon)
//   - React Native (iOS app)
//
// Each platform provides its own implementation via setPlatform().
// ─────────────────────────────────────────────────────────────────────────────

/**
 * File system abstraction — replaces `fs.promises`.
 * All paths are absolute strings. The implementation is responsible for
 * resolving them to the appropriate location on the platform.
 */
export interface StorageProvider {
    readFile(filePath: string, encoding?: string): Promise<string>;
    writeFile(filePath: string, content: string): Promise<void>;
    readdir(dirPath: string): Promise<string[]>;
    mkdir(dirPath: string, opts?: { recursive?: boolean }): Promise<void>;
    rename(oldPath: string, newPath: string): Promise<void>;
    /** Throws if path does not exist (like fs.access). */
    access(filePath: string): Promise<void>;
    unlink(filePath: string): Promise<void>;
    stat(filePath: string): Promise<FileStat>;
    /** Optional: resolve symlinks to real path. Falls back to identity if not implemented. */
    realpath?(filePath: string): Promise<string>;
}

export interface FileStat {
    isDirectory: boolean;
    isFile: boolean;
    mtime: Date;
    size: number;
}

/**
 * Path manipulation — replaces Node.js `path` module.
 * All operations are synchronous string manipulation (no I/O).
 */
export interface PathProvider {
    join(...parts: string[]): string;
    basename(p: string, ext?: string): string;
    dirname(p: string): string;
    resolve(...parts: string[]): string;
    extname(p: string): string;
    readonly sep: string;
}

/**
 * Secrets storage — replaces reading `~/.phaibel/secrets.json`.
 * On Node.js: reads/writes the JSON file.
 * On iOS: uses Keychain.
 */
export interface SecretsProvider {
    getApiKey(provider: string): Promise<string | null>;
    setApiKey(provider: string, key: string): Promise<void>;
    /** Load all secrets (for display/config UI). */
    loadAll(): Promise<Record<string, { apiKey: string }>>;
}

/**
 * Top-level platform provider — assembled from the above interfaces
 * plus platform-specific utilities.
 */
export interface PlatformProvider {
    readonly storage: StorageProvider;
    readonly paths: PathProvider;
    readonly secrets: SecretsProvider;

    /** Home directory (e.g. /Users/gary on macOS, app Documents on iOS). */
    homedir(): string;

    /** System config directory (~/.phaibel/ on Node, app support on iOS). */
    systemDir(): string;

    /** Generate a random alphanumeric ID of the given length. */
    generateId(length: number): string;
}
