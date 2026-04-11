// ─────────────────────────────────────────────────────────────────────────────
// CxMS — Boundary Guard
// ─────────────────────────────────────────────────────────────────────────────
// Ensures file operations stay within the Foundation root directory.
// Prevents path traversal attacks and accidental writes outside the boundary.
// ─────────────────────────────────────────────────────────────────────────────

import { getPlatform } from '../platform/index.js';
import { findFoundationRoot } from '../state/manager.js';

export class BoundaryViolationError extends Error {
    constructor(filepath: string, foundationRoot: string) {
        super(`Path "${filepath}" is outside the Foundation boundary "${foundationRoot}"`);
        this.name = 'BoundaryViolationError';
    }
}

/**
 * Assert that a filepath is within the Foundation root directory.
 * Resolves both paths to absolute form before comparing.
 * Throws BoundaryViolationError if the path escapes the Foundation.
 */
export async function assertWithinFoundation(filepath: string): Promise<void> {
    const root = await findFoundationRoot();
    if (!root) {
        throw new Error('No Foundation found — cannot verify boundary');
    }
    await assertWithinRoot(filepath, root);
}

/**
 * Assert that a filepath is within a known root directory.
 * Resolves symlinks (macOS: /var → /private/var) to avoid false violations.
 */
export async function assertWithinRoot(filepath: string, foundationRoot: string): Promise<void> {
    const { paths, storage } = getPlatform();

    let resolved = paths.resolve(filepath);
    let rootResolved = paths.resolve(foundationRoot);

    // Resolve symlinks when possible to avoid /var vs /private/var mismatches
    if (storage.realpath) {
        try { rootResolved = await storage.realpath(rootResolved); } catch { /* ignore */ }
        try { resolved = await storage.realpath(resolved); } catch {
            // File may not exist yet — resolve its parent instead
            const dir = paths.dirname(resolved);
            const base = paths.basename(resolved);
            try { resolved = paths.join(await storage.realpath(dir), base); } catch { /* keep original */ }
        }
    }

    if (resolved !== rootResolved && !resolved.startsWith(rootResolved + paths.sep)) {
        throw new BoundaryViolationError(filepath, foundationRoot);
    }
}
