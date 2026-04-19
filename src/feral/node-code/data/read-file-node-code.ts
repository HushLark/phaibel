// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Read File NodeCode
// ─────────────────────────────────────────────────────────────────────────────

import { readFile } from 'node:fs/promises';
import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { assertPathAllowed, FileAccessDeniedError } from '../../security/file-access-guard.js';

export class ReadFileNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'file_path', name: 'File Path', description: 'Path to the file to read. Supports {key} interpolation from context.', type: 'string' },
        { key: 'context_path', name: 'Context Path', description: 'Context key to store the file contents.', type: 'string' },
        { key: 'encoding', name: 'Encoding', description: 'File encoding.', type: 'string', default: 'utf-8', isOptional: true },
    ];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'File read successfully.' },
        { status: ResultStatus.ERROR, description: 'File could not be read.' },
    ];

    constructor() {
        super('read_file', 'Read File', 'Reads a file into the context.', NodeCodeCategory.DATA);
    }

    async process(context: Context): Promise<Result> {
        const filePathTemplate = this.getRequiredConfigValue('file_path') as string;
        const contextPath = this.getRequiredConfigValue('context_path') as string;
        const encoding = this.getOptionalConfigValue('encoding', 'utf-8') as BufferEncoding;

        // Interpolate {key} references
        const filePath = filePathTemplate.replace(/\{(\w+)\}/g, (_, key: string) => {
            return String(context.get(key) ?? '');
        });

        try {
            await assertPathAllowed(filePath);
        } catch (error) {
            if (error instanceof FileAccessDeniedError) {
                return this.result(ResultStatus.ERROR, error.message);
            }
            throw error;
        }

        try {
            const content = await readFile(filePath, { encoding });
            context.set(contextPath, content);
            return this.result(ResultStatus.OK, `Read file "${filePath}" → "${contextPath}" (${content.length} chars).`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.result(ResultStatus.ERROR, `Failed to read file "${filePath}": ${message}`);
        }
    }
}
