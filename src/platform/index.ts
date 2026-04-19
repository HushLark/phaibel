// ─────────────────────────────────────────────────────────────────────────────
// Platform Abstraction — Singleton Access
// ──��──────────────────────────────────────────────────────────────────────────
//
// getPlatform() returns the current platform provider.
// On Node.js it auto-initializes with createNodePlatform().
// On iOS (React Native), call setPlatform() before any Phaibel code runs.
// ─────────────────────────────────────────────────────────────────────────────

import { createRequire } from 'node:module';
import type { PlatformProvider, StorageProvider, PathProvider, SecretsProvider } from './types.js';

let _platform: PlatformProvider | null = null;

/**
 * Get the current platform provider.
 * Auto-initializes with the Node.js provider if not set.
 */
export function getPlatform(): PlatformProvider {
    if (!_platform) {
        // Lazy-load the Node.js provider to avoid importing fs/path/os
        // at module evaluation time (which would fail on React Native).
        // Use createRequire for ESM compatibility (require is not available in ESM).
        const nodeRequire = createRequire(import.meta.url);
        const { createNodePlatform } = nodeRequire('./node.js') as { createNodePlatform: () => PlatformProvider };
        _platform = createNodePlatform();
    }
    return _platform;
}

/**
 * Set a custom platform provider (e.g. for iOS/React Native).
 * Must be called before any Phaibel core code accesses getPlatform().
 */
export function setPlatform(provider: PlatformProvider): void {
    _platform = provider;
}

/**
 * Reset the platform singleton (for testing).
 */
export function resetPlatform(): void {
    _platform = null;
}

// ── Convenience re-exports ──────────────────────────────────────────────────

export type { PlatformProvider, StorageProvider, PathProvider, SecretsProvider };
export type { FileStat } from './types.js';
