// ─────────────────────────────────────────────────────────────────────────────
// Feral — File Access Guard
// ─────────────────────────────────────────────────────────────────────────────
// Restricts NodeCode file operations to allowed directories:
//   1. The active vault root (and everything under it)
//   2. ~/.phaibel/ (system configuration directory)
//
// All NodeCodes that perform file I/O must call assertPathAllowed() before
// any read/write operation.
// ─────────────────────────────────────────────────────────────────────────────

import { getPlatform } from '../../platform/index.js';
import { findVaultRoot } from '../../state/manager.js';

function getSystemDir(): string {
    return getPlatform().systemDir();
}

export class FileAccessDeniedError extends Error {
    constructor(filePath: string) {
        super(
            `File access denied: "${filePath}" is outside the vault and ~/.phaibel/. ` +
            `Feral NodeCodes may only access files within the active vault or the system directory.`,
        );
        this.name = 'FileAccessDeniedError';
    }
}

/**
 * Resolve a file path to absolute form, normalising away any `..` segments.
 */
function resolveAbsolute(filePath: string): string {
    return getPlatform().paths.resolve(filePath);
}

/**
 * Check whether `filePath` falls within `allowedDir` (inclusive).
 * Both paths are normalised before comparison.
 */
function isUnder(filePath: string, allowedDir: string): boolean {
    const resolved = resolveAbsolute(filePath);
    const dir = resolveAbsolute(allowedDir);
    // Add trailing separator so "/foo/bar" doesn't match "/foo/barbaz"
    return resolved === dir || resolved.startsWith(dir + getPlatform().paths.sep);
}

/**
 * Assert that a file path is within an allowed directory.
 * Throws FileAccessDeniedError if not.
 *
 * Allowed directories:
 *   - The active vault root (if one exists)
 *   - ~/.phaibel/ (always allowed for config/state access)
 */
export async function assertPathAllowed(filePath: string): Promise<void> {
    const resolved = resolveAbsolute(filePath);

    // Always allow ~/.phaibel/
    if (isUnder(resolved, getSystemDir())) return;

    // Allow the vault root (if one is active)
    const vaultRoot = await findVaultRoot();
    if (vaultRoot && isUnder(resolved, vaultRoot)) return;

    throw new FileAccessDeniedError(resolved);
}

/**
 * Synchronous variant for use in sync NodeCode paths.
 * Requires the vault root to be passed in explicitly.
 */
export function assertPathAllowedSync(filePath: string, vaultRoot: string | null): void {
    const resolved = resolveAbsolute(filePath);

    if (isUnder(resolved, getSystemDir())) return;
    if (vaultRoot && isUnder(resolved, vaultRoot)) return;

    throw new FileAccessDeniedError(resolved);
}
