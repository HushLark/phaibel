/**
 * Startup banner for the Phaibel interactive shell.
 *
 * Displays ASCII art, a randomised greeting, and current state
 * (service, vault) every time the shell boots.
 */
import { promises as fs } from 'fs';
import path from 'path';
import chalk from 'chalk';
import { getResponse } from '../responses.js';
import { getDaemonStatus } from '../service/daemon.js';
import { findVaultRoot, getAgentName } from '../state/manager.js';
/**
 * Load the ASCII art from phaibel.txt (bundled alongside the source).
 */
async function loadAsciiArt() {
    try {
        const artPath = path.join(import.meta.dirname, '..', 'phaibel.txt');
        return await fs.readFile(artPath, 'utf-8');
    }
    catch {
        // Fallback if the file cannot be found
        return '🤖 Phaibel';
    }
}
/**
 * Gather the current system state in parallel.
 */
async function gatherState() {
    const [daemon, vault, agentName] = await Promise.all([
        getDaemonStatus().catch(() => ({ running: false })),
        findVaultRoot().catch(() => null),
        getAgentName().catch(() => 'Agent'),
    ]);
    return {
        serviceRunning: daemon.running,
        vault,
        agentName,
    };
}
/**
 * Print the full startup banner.
 */
export async function printStartupBanner() {
    // Kick off everything in parallel
    const [art, greeting, state] = await Promise.all([
        loadAsciiArt(),
        Promise.resolve(getResponse('startup_greeting')),
        gatherState(),
    ]);
    // ── ASCII art ───────────────────────────────────────────────────────
    console.log(chalk.cyan(art));
    // ── Greeting ────────────────────────────────────────────────────────
    console.log(chalk.bold.cyan(greeting));
    console.log('');
    // ── State summary ───────────────────────────────────────────────────
    const serviceIcon = state.serviceRunning
        ? chalk.green('●') + chalk.white(' Service running')
        : chalk.red('○') + chalk.white(' Service stopped');
    const vaultLabel = state.vault
        ? chalk.white(`🏠 ${path.basename(state.vault)}`)
        : chalk.yellow('🏠 no vault (run phaibel init)');
    console.log(`  ${serviceIcon}  │  ${vaultLabel}`);
    console.log(chalk.gray('  Tab-complete commands • Up/Down for history • Type "exit" or Ctrl+D to leave\n'));
}
