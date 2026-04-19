// ─────────────────────────────────────────────────────────────────────────────
// Feral Agent — Write File NodeCode
// ─────────────────────────────────────────────────────────────────────────────

import { getPlatform } from '../../../platform/index.js';
import { AbstractNodeCode } from '../../node-code/abstract-node-code.js';
import { NodeCodeCategory } from '../../node-code/node-code.js';
import type { ConfigurationDescription } from '../../configuration/configuration-description.js';
import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import { findVaultRoot } from '../../../state/manager.js';
import { assertPathAllowedSync, FileAccessDeniedError } from '../../security/file-access-guard.js';

/**
 * Writes a context value to a file on disk.
 */
export class WriteFileNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'source_context_path', name: 'Source Path', description: 'Context path containing the content to write', type: 'string' },
        { key: 'file_path', name: 'File Path', description: 'Destination file path (can use {context_key} interpolation)', type: 'string' },
        { key: 'create_directories', name: 'Create Dirs', description: 'Whether to create parent directories', type: 'boolean', isOptional: true, default: true },
    ];

    constructor() {
        super('write_file', 'Write File', 'Writes context value to a file', NodeCodeCategory.DATA);
    }

    async process(context: Context): Promise<Result> {
        const sourcePath = this.getRequiredConfigValue('source_context_path') as string;
        let filePath = this.getRequiredConfigValue('file_path') as string;
        const createDirs = this.getOptionalConfigValue('create_directories', true) as boolean;

        if (!context.has(sourcePath)) {
            return this.result(ResultStatus.ERROR, `No content at context path "${sourcePath}"`);
        }

        // Interpolate context values in file path
        filePath = filePath.replace(/\{(\w+)\}/g, (_, key: string) => {
            return String(context.get(key) ?? '');
        });

        const content = context.get(sourcePath);
        const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);

        try {
            const vaultRoot = await findVaultRoot();
            assertPathAllowedSync(filePath, vaultRoot);
        } catch (error) {
            if (error instanceof FileAccessDeniedError) {
                return this.result(ResultStatus.ERROR, error.message);
            }
            throw error;
        }

        try {
            const { storage, paths } = getPlatform();
            if (createDirs) {
                await storage.mkdir(paths.dirname(filePath), { recursive: true });
            }
            await storage.writeFile(filePath, text);
            return this.result(ResultStatus.OK, `Wrote ${text.length} chars to ${filePath}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.result(ResultStatus.ERROR, `Write file error: ${message}`);
        }
    }
}
