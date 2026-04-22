// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Agent Speak NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { getResponseWith } from '../../../responses.js';
export class AgentSpeakNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'response_key', name: 'Response Key', description: 'Key from the response catalog (e.g. greeting, task_saved, error).', type: 'string' },
        { key: 'context_path', name: 'Context Path', description: 'Where to store the rendered message.', type: 'string', default: 'output', isOptional: true },
        { key: 'extra_tokens', name: 'Extra Tokens', description: 'Comma-separated key=context_path mappings for custom token replacement.', type: 'string', isOptional: true },
    ];
    static resultDescriptions = [
        { status: ResultStatus.OK, description: 'Message rendered and stored in context.' },
        { status: ResultStatus.ERROR, description: 'Invalid response key or rendering failure.' },
    ];
    constructor() {
        super('agent_speak', 'Agent Speak', 'Picks a random response from the catalog, replaces tokens with context values, and stores the result.', NodeCodeCategory.WORK);
    }
    async process(context) {
        const responseKey = this.getRequiredConfigValue('response_key');
        const contextPath = this.getOptionalConfigValue('context_path', 'output');
        const extraTokens = this.getOptionalConfigValue('extra_tokens', '');
        try {
            // {name} is auto-substituted by getResponseWith
            // Build replacement map for any extra tokens
            const replacements = {};
            // Parse extra_tokens: "title=entity_title,count=item_count"
            if (extraTokens) {
                for (const pair of extraTokens.split(',')) {
                    const [tokenName, ctxKey] = pair.split('=').map(s => s.trim());
                    if (tokenName && ctxKey) {
                        replacements[tokenName] = String(context.get(ctxKey) ?? '');
                    }
                }
            }
            // Also pull any {key} tokens from context directly
            const message = getResponseWith(responseKey, replacements);
            // Do a second pass to replace any remaining {key} tokens with context values
            const finalMessage = message.replace(/\{(\w+)\}/g, (_match, key) => {
                if (key in replacements)
                    return replacements[key];
                const ctxVal = context.get(key);
                return ctxVal != null ? String(ctxVal) : _match;
            });
            context.set(contextPath, finalMessage);
            return this.result(ResultStatus.OK, finalMessage);
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return this.result(ResultStatus.ERROR, `Agent speak failed for "${responseKey}": ${msg}`);
        }
    }
}
