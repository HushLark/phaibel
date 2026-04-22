// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — CLI Command NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { execSync } from 'node:child_process';
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { findVaultRoot } from '../../../state/manager.js';
export class CliCommandNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'command', name: 'Command', description: 'Shell command to execute. Supports {key} interpolation from context.', type: 'string' },
        { key: 'context_path', name: 'Context Path', description: 'Context key to store stdout.', type: 'string' },
        { key: 'timeout_ms', name: 'Timeout (ms)', description: 'Max execution time in milliseconds.', type: 'int', default: 5000, isOptional: true },
    ];
    static resultDescriptions = [
        { status: ResultStatus.OK, description: 'Command executed successfully.' },
        { status: ResultStatus.ERROR, description: 'Command failed or timed out.' },
    ];
    constructor() {
        super('cli_command', 'CLI Command', 'Executes a local shell command and stores stdout in the context.', NodeCodeCategory.WORK);
    }
    async process(context) {
        const commandTemplate = this.getRequiredConfigValue('command');
        const contextPath = this.getRequiredConfigValue('context_path');
        const timeoutMs = Number(this.getOptionalConfigValue('timeout_ms', 5000));
        // Interpolate {key} references from context
        const command = commandTemplate.replace(/\{(\w+)\}/g, (_, key) => {
            return String(context.get(key) ?? '');
        });
        // Sandbox: run commands with cwd set to the vault root (if available)
        const vaultRoot = await findVaultRoot();
        const cwd = vaultRoot ?? undefined;
        try {
            const stdout = execSync(command, {
                encoding: 'utf-8',
                timeout: timeoutMs,
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd,
            }).trim();
            context.set(contextPath, stdout);
            return this.result(ResultStatus.OK, `${contextPath} = "${stdout.slice(0, 80)}"`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            context.set(contextPath, '');
            return this.result(ResultStatus.ERROR, `CLI command failed: ${message}`);
        }
    }
}
