// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Clean LLM JSON NodeCode
// ─────────────────────────────────────────────────────────────────────────────
//
// LLMs often wrap JSON in markdown code fences (```json ... ```).
// This node strips those fences so the downstream json_decode node can parse it.
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
export class CleanLlmJsonNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        {
            key: 'source_context_path',
            name: 'Source Path',
            description: 'Context key containing the raw LLM response.',
            type: 'string',
        },
        {
            key: 'target_context_path',
            name: 'Target Path',
            description: 'Context key to store the cleaned JSON string.',
            type: 'string',
        },
    ];
    static resultDescriptions = [
        { status: ResultStatus.OK, description: 'JSON cleaned successfully.' },
        { status: ResultStatus.ERROR, description: 'No content found.' },
    ];
    constructor() {
        super('clean_llm_json', 'Clean LLM JSON', 'Strips markdown code fences from LLM responses to extract clean JSON.', NodeCodeCategory.DATA);
    }
    async process(context) {
        const sourcePath = this.getRequiredConfigValue('source_context_path');
        const targetPath = this.getRequiredConfigValue('target_context_path');
        const raw = context.getString(sourcePath).trim();
        if (!raw) {
            return this.result(ResultStatus.ERROR, 'Source context is empty.');
        }
        // Try to extract JSON from code fences
        const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
        const cleaned = fenceMatch ? fenceMatch[1].trim() : raw;
        context.set(targetPath, cleaned);
        return this.result(ResultStatus.OK, `Cleaned JSON (${cleaned.length} chars) stored in "${targetPath}".`);
    }
}
