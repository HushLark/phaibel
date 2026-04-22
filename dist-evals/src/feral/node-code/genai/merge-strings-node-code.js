// ─────────────────────────────────────────────────────────────────────────────
// Feral Agent — Merge Strings NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { AbstractNodeCode } from '../../node-code/abstract-node-code.js';
import { NodeCodeCategory } from '../../node-code/node-code.js';
import { ResultStatus } from '../../result/result.js';
/**
 * Concatenates an array of strings from context into a single string.
 * Useful for assembling multi-part prompts.
 */
export class MergeStringsNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'source_context_paths', name: 'Source Paths', description: 'Comma-separated context paths to merge', type: 'string' },
        { key: 'target_context_path', name: 'Target Path', description: 'Context path to store the merged result', type: 'string', isOptional: true, default: 'merged_text' },
        { key: 'separator', name: 'Separator', description: 'Separator between merged strings', type: 'string', isOptional: true, default: '\n' },
    ];
    constructor() {
        super('merge_strings', 'Merge Strings', 'Concatenates context strings into one', NodeCodeCategory.DATA);
    }
    async process(context) {
        const sourcePaths = this.getRequiredConfigValue('source_context_paths').split(',').map(p => p.trim());
        const targetPath = this.getOptionalConfigValue('target_context_path', 'merged_text');
        const separator = this.getOptionalConfigValue('separator', '\n');
        const parts = [];
        for (const path of sourcePaths) {
            if (context.has(path)) {
                parts.push(String(context.get(path)));
            }
        }
        context.set(targetPath, parts.join(separator));
        return this.result(ResultStatus.OK, `Merged ${parts.length} strings into "${targetPath}"`);
    }
}
