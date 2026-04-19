// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Agent Speak NodeCode
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { getResponseWith, type ResponseKey } from '../../../responses.js';

export class AgentSpeakNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'response_key', name: 'Response Key', description: 'Key from the response catalog (e.g. greeting, task_saved, error).', type: 'string' },
        { key: 'context_path', name: 'Context Path', description: 'Where to store the rendered message.', type: 'string', default: 'output', isOptional: true },
        { key: 'extra_tokens', name: 'Extra Tokens', description: 'Comma-separated key=context_path mappings for custom token replacement.', type: 'string', isOptional: true },
    ];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Message rendered and stored in context.' },
        { status: ResultStatus.ERROR, description: 'Invalid response key or rendering failure.' },
    ];

    constructor() {
        super('agent_speak', 'Agent Speak', 'Picks a random response from the catalog, replaces tokens with context values, and stores the result.', NodeCodeCategory.WORK);
    }

    async process(context: Context): Promise<Result> {
        const responseKey = this.getRequiredConfigValue('response_key') as string;
        const contextPath = this.getOptionalConfigValue('context_path', 'output') as string;
        const extraTokens = this.getOptionalConfigValue('extra_tokens', '') as string;

        try {
            // {name} is auto-substituted by getResponseWith
            // Build replacement map for any extra tokens
            const replacements: Record<string, string> = {};

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
            const message = getResponseWith(responseKey as ResponseKey, replacements);

            // Do a second pass to replace any remaining {key} tokens with context values
            const finalMessage = message.replace(/\{(\w+)\}/g, (_match: string, key: string) => {
                if (key in replacements) return replacements[key];
                const ctxVal = context.get(key);
                return ctxVal != null ? String(ctxVal) : _match;
            });

            context.set(contextPath, finalMessage);
            return this.result(ResultStatus.OK, finalMessage);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return this.result(ResultStatus.ERROR, `Agent speak failed for "${responseKey}": ${msg}`);
        }
    }
}