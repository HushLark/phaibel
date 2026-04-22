import { getPlatform } from '../platform/index.js';
import { getVaultRoot } from '../state/manager.js';
const CONTEXT_FILES = ['.cxms.md', '.phaibel.md', '.vault.md'];
/**
 * Reads the context file from a directory (.cxms.md → .phaibel.md → .vault.md fallback).
 * Returns the content or null if none found.
 */
async function readContextFile(dirPath) {
    const { storage, paths } = getPlatform();
    for (const filename of CONTEXT_FILES) {
        try {
            return await storage.readFile(paths.join(dirPath, filename));
        }
        catch {
            // Try next
        }
    }
    return null;
}
/**
 * Reads .vault.md files from the target path up to the vault root.
 * Returns an array of context strings, ordered from deepest to root.
 */
export async function buildContextChain(targetPath) {
    const vaultRoot = await getVaultRoot();
    const contexts = [];
    const { paths } = getPlatform();
    let currentPath = paths.resolve(targetPath);
    const rootPath = paths.resolve(vaultRoot);
    // Walk up the directory tree
    while (currentPath.startsWith(rootPath)) {
        const content = await readContextFile(currentPath);
        if (content) {
            contexts.push(content);
        }
        // Move to parent
        const parentPath = paths.dirname(currentPath);
        if (parentPath === currentPath) {
            break; // Reached filesystem root
        }
        currentPath = parentPath;
    }
    return contexts;
}
/**
 * Gets the full context chain as a single formatted string.
 * Order: root (broadest) to target (most specific).
 */
export async function getContextString(targetPath) {
    const contexts = await buildContextChain(targetPath);
    if (contexts.length === 0) {
        return '';
    }
    // Reverse so root context comes first (most general to most specific)
    const orderedContexts = contexts.reverse();
    return orderedContexts.join('\n\n---\n\n');
}
/**
 * Gets the context for the vault root.
 */
export async function getVaultContext() {
    const vaultRoot = await getVaultRoot();
    return getContextString(vaultRoot);
}
/**
 * Gets the context for notes in the vault.
 * Convenience wrapper for getSubdirectoryContext.
 */
export async function getNotesContext() {
    return getSubdirectoryContext('notes');
}
/**
 * Gets context for a specific subdirectory within the vault.
 * Gathers .vault.md files in this order (broadest to most specific):
 * 1. .vault.md (vault root)
 * 2. {subdirectory}/.vault.md
 *
 * @param subdirectory - The subdirectory within the vault (e.g., 'notes', 'research', 'todos')
 */
export async function getSubdirectoryContext(subdirectory) {
    const vaultRoot = await getVaultRoot();
    const contexts = [];
    // Define the hierarchy from root to subdirectory (broadest to most specific)
    const hierarchy = [
        vaultRoot, // .vault.md
        getPlatform().paths.join(vaultRoot, subdirectory), // {subdirectory}/.vault.md
    ];
    for (const dirPath of hierarchy) {
        const content = await readContextFile(dirPath);
        if (content) {
            contexts.push(content);
        }
    }
    return contexts.join('\n\n---\n\n');
}
/**
 * Gets the context for todos in the vault.
 * Convenience wrapper for getSubdirectoryContext.
 */
export async function getTodosContext() {
    return getSubdirectoryContext('todos');
}
/**
 * Gets the context for events in the vault.
 * Convenience wrapper for getSubdirectoryContext.
 */
export async function getEventsContext() {
    return getSubdirectoryContext('events');
}
/**
 * Gets the context for inbox in the vault.
 * Convenience wrapper for getSubdirectoryContext.
 */
export async function getInboxContext() {
    return getSubdirectoryContext('inbox');
}
/**
 * Gets the context for people in the vault.
 * Convenience wrapper for getSubdirectoryContext.
 */
export async function getPeopleContext() {
    return getSubdirectoryContext('people');
}
/**
 * Gets enriched context that includes .vault.md chain PLUS resolved
 * @mentions and entity:slug cross-references found in the entity content.
 */
export async function getEnrichedContext(subdirectory, entityContent) {
    const { resolveReferences } = await import('./mentions.js');
    const baseContext = await getSubdirectoryContext(subdirectory);
    const refsContext = await resolveReferences(entityContent);
    return refsContext ? `${baseContext}\n\n---\n\n${refsContext}` : baseContext;
}
