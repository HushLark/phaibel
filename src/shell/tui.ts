/**
 * TUI status bar for the Phaibel interactive shell.
 *
 * Simple inline approach: prints a status divider line before each prompt.
 * No alternate screen, no cursor tricks — just works with readline.
 */

import chalk from 'chalk';
import { printStartupBanner } from './banner.js';

// ─────────────────────────────────────────────────────────────────────────────
// Status data
// ─────────────────────────────────────────────────────────────────────────────

export interface ShellStatus {
    serviceRunning: boolean;
    queueSize: number;
    queueMax: number;
    memoryMB: number;
    entityCount: number;
    project: string | null;
}

const DEFAULT_STATUS: ShellStatus = {
    serviceRunning: false,
    queueSize: 0,
    queueMax: 10,
    memoryMB: 0,
    entityCount: 0,
    project: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// StatusBar class
// ─────────────────────────────────────────────────────────────────────────────

export class StatusBar {
    private status: ShellStatus = { ...DEFAULT_STATUS };

    /**
     * Update status data (does NOT print — call print() separately).
     */
    update(status: Partial<ShellStatus>): void {
        Object.assign(this.status, status);
    }

    /**
     * Print the status divider line.
     * Call this right before each prompt.
     */
    print(): void {
        const cols = process.stdout.columns || 80;

        // Build segments
        const service = this.status.serviceRunning
            ? chalk.green('●') + chalk.white(' Running')
            : chalk.red('○') + chalk.white(' Stopped');

        const queue = this.status.queueSize > 0
            ? chalk.yellow('⬡') + chalk.white(` ${this.status.queueSize}/${this.status.queueMax}`)
            : chalk.gray('⬡') + chalk.gray(` ${this.status.queueSize}/${this.status.queueMax}`);

        const memory = this.status.memoryMB > 0
            ? chalk.white(`💾 ${this.status.memoryMB}MB`)
            : chalk.gray('💾 —');

        const entities = this.status.entityCount > 0
            ? chalk.white(`📄 ${this.status.entityCount}`)
            : chalk.gray('📄 0');

        const project = this.status.project
            ? chalk.white(`📁 ${this.status.project}`)
            : chalk.gray('📁 none');

        const content = ` ${service} │ ${queue} │ ${memory} │ ${entities} │ ${project} `;

        // Fill remaining width with ─
        // Visible character count (approximate — emojis and ANSI make exact count hard)
        const visibleLen = this.stripAnsi(content).length;
        const padding = Math.max(0, cols - visibleLen - 2);
        const leftDash = '─';
        const rightDashes = '─'.repeat(padding);

        console.log(chalk.gray(`${leftDash}${content}${rightDashes}`));
    }

    /**
     * Print the startup banner with ASCII art, greeting, and state summary.
     */
    async printWelcome(): Promise<void> {
        await printStartupBanner();
    }

    private stripAnsi(str: string): string {
        return str.replace(/\x1b\[[0-9;]*m/g, '');
    }
}
