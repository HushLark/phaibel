// ─────────────────────────────────────────────────────────────────────────────
// CxMS — Boundary Guard
// ─────────────────────────────────────────────────────────────────────────────
// Ensures file operations stay within the Foundation root directory.
// Prevents path traversal attacks and accidental writes outside the boundary.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs';
import path from 'path';
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
    assertWithinRoot(filepath, root);
}

/**
 * Synchronous version when the root is already known.
 */
export function assertWithinRoot(filepath: string, foundationRoot: string): void {
    // Use realpath to resolve symlinks (e.g. /var → /private/var on macOS)
    let resolved: string;
    let rootResolved: string;
    try {
        resolved = fs.realpathSync(path.resolve(filepath));
        rootResolved = fs.realpathSync(path.resolve(foundationRoot));
    } catch {
        // If the path doesn't exist yet (about to be created), resolve parent
        resolved = path.resolve(filepath);
        rootResolved = path.resolve(foundationRoot);
        try { rootResolved = fs.realpathSync(rootResolved); } catch { /* keep resolved */ }
        try {
            const parent = fs.realpathSync(path.dirname(resolved));
            resolved = path.join(parent, path.basename(resolved));
        } catch { /* keep resolved */ }
    }

    // The resolved path must start with the root path + separator (or be the root itself)
    if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
        throw new BoundaryViolationError(filepath, foundationRoot);
    }
}
