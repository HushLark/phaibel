// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — JSON Decode NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
export class JsonDecodeNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'source_context_path', name: 'Source Path', description: 'Context key containing the JSON string.', type: 'string' },
        { key: 'target_context_path', name: 'Target Path', description: 'Context key to store the parsed object.', type: 'string' },
    ];
    static resultDescriptions = [
        { status: ResultStatus.OK, description: 'JSON decoded successfully.' },
        { status: ResultStatus.ERROR, description: 'Invalid JSON string.' },
    ];
    constructor() {
        super('json_decode', 'JSON Decode', 'Decodes a JSON string from context into an object.', NodeCodeCategory.DATA);
    }
    async process(context) {
        const sourcePath = this.getRequiredConfigValue('source_context_path');
        const targetPath = this.getRequiredConfigValue('target_context_path');
        const jsonString = context.getString(sourcePath);
        try {
            const parsed = JSON.parse(jsonString);
            context.set(targetPath, parsed);
            return this.result(ResultStatus.OK, `Decoded JSON from "${sourcePath}" → "${targetPath}".`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.result(ResultStatus.ERROR, `Failed to decode JSON from "${sourcePath}": ${message}`);
        }
    }
}
