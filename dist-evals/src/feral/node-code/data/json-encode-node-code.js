// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — JSON Encode NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
export class JsonEncodeNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'source_context_path', name: 'Source Path', description: 'Context key containing the value to encode.', type: 'string' },
        { key: 'target_context_path', name: 'Target Path', description: 'Context key to store the JSON string.', type: 'string' },
        { key: 'pretty', name: 'Pretty Print', description: 'Indent the JSON output.', type: 'boolean', default: false, isOptional: true },
    ];
    static resultDescriptions = [
        { status: ResultStatus.OK, description: 'Value encoded to JSON successfully.' },
    ];
    constructor() {
        super('json_encode', 'JSON Encode', 'Encodes a context value to a JSON string.', NodeCodeCategory.DATA);
    }
    async process(context) {
        const sourcePath = this.getRequiredConfigValue('source_context_path');
        const targetPath = this.getRequiredConfigValue('target_context_path');
        const pretty = this.getOptionalConfigValue('pretty', false);
        const value = context.get(sourcePath);
        const indent = pretty ? 2 : undefined;
        const jsonString = JSON.stringify(value, null, indent);
        context.set(targetPath, jsonString);
        return this.result(ResultStatus.OK, `Encoded "${sourcePath}" → JSON in "${targetPath}".`);
    }
}
