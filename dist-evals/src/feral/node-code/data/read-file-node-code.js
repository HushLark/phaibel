// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Read File NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { readFile } from 'node:fs/promises';
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { assertPathAllowed, FileAccessDeniedError } from '../../security/file-access-guard.js';
export class ReadFileNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'file_path', name: 'File Path', description: 'Path to the file to read. Supports {key} interpolation from context.', type: 'string' },
        { key: 'context_path', name: 'Context Path', description: 'Context key to store the file contents.', type: 'string' },
        { key: 'encoding', name: 'Encoding', description: 'File encoding.', type: 'string', default: 'utf-8', isOptional: true },
    ];
    static resultDescriptions = [
        { status: ResultStatus.OK, description: 'File read successfully.' },
        { status: ResultStatus.ERROR, description: 'File could not be read.' },
    ];
    constructor() {
        super('read_file', 'Read File', 'Reads a file into the context.', NodeCodeCategory.DATA);
    }
    async process(context) {
        const filePathTemplate = this.getRequiredConfigValue('file_path');
        const contextPath = this.getRequiredConfigValue('context_path');
        const encoding = this.getOptionalConfigValue('encoding', 'utf-8');
        // Interpolate {key} references
        const filePath = filePathTemplate.replace(/\{(\w+)\}/g, (_, key) => {
            return String(context.get(key) ?? '');
        });
        try {
            await assertPathAllowed(filePath);
        }
        catch (error) {
            if (error instanceof FileAccessDeniedError) {
                return this.result(ResultStatus.ERROR, error.message);
            }
            throw error;
        }
        try {
            const content = await readFile(filePath, { encoding });
            context.set(contextPath, content);
            return this.result(ResultStatus.OK, `Read file "${filePath}" → "${contextPath}" (${content.length} chars).`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.result(ResultStatus.ERROR, `Failed to read file "${filePath}": ${message}`);
        }
    }
}
