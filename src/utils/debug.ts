/**
 * Centralized debug logger.
 *
 * By default logs only the error message (single line).
 * Set PHAIBEL_DEBUG=1 to get full stack traces.
 */

const VERBOSE = process.env.PHAIBEL_DEBUG === '1';

/**
 * Log a debug/error message in a compact, user-friendly format.
 *
 * In normal mode: `[phaibel:config] ENOENT: no such file or directory, open '...'`
 * In debug mode:  full stack trace (PHAIBEL_DEBUG=1)
 */
export function debug(tag: string, err: unknown): void {
    if (VERBOSE) {
        console.debug(`[${tag}]`, err);
        return;
    }

    // In normal mode, show just the one-line message
    if (err instanceof Error) {
        // Suppress expected ENOENT errors (missing config/dir on first run)
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return; // Silently ignore — these are expected
        }
        console.debug(`[${tag}] ${err.message}`);
    } else {
        console.debug(`[${tag}] ${String(err)}`);
    }
}
