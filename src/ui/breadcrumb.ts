/**
 * Breadcrumb navigation for the Phaibel TUI.
 *
 * Maintains a dot-separated path (e.g. `phaibel.note`) so the user always
 * knows where they are in the interface hierarchy.
 *
 *   🤖 phaibel>              ← shell root
 *   🤖 phaibel.note>         ← inside the note editor
 *   🤖 phaibel.todo>         ← inside the todo editor
 */
import chalk from 'chalk';

let segments: string[] = ['phaibel'];

/** Push a new segment onto the breadcrumb path. */
export function pushCrumb(segment: string): void {
    segments.push(segment);
}

/** Pop the last segment from the breadcrumb path. */
export function popCrumb(): void {
    if (segments.length > 1) segments.pop();
}

/** Reset the breadcrumb path back to root. */
export function resetCrumbs(): void {
    segments = ['phaibel'];
}

/** Get the current breadcrumb segments (for display in headers, etc.). */
export function getCrumbs(): string[] {
    return [...segments];
}

/** Build the styled prompt string from the current breadcrumb path. */
export function breadcrumbPrompt(): string {
    const path = segments.join('.');
    return chalk.cyan(path) + chalk.gray('> ');
}
