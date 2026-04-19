// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — LLM Chat NodeCode
// ─────────────────────────────────────────────────────────────────────────────
//
// A generic NodeCode that calls the LLM provider system.
// Configured with capability, prompt template, optional system prompt,
// and context I/O paths.  Prompt templates support {context_key} interpolation.
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { getModelForCapability } from '../../../llm/router.js';
import type { LLMCapability } from '../../../schemas/index.js';

export class LlmChatNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        {
            key: 'capability',
            name: 'LLM Capability',
            description: 'Which LLM capability to use (reason, summarize, categorize, format, chat).',
            type: 'string',
            default: 'reason',
            options: ['reason', 'summarize', 'categorize', 'format', 'chat'],
        },
        {
            key: 'prompt',
            name: 'Prompt Template',
            description: 'The user prompt. Use {context_key} to interpolate context values.',
            type: 'string',
        },
        {
            key: 'system_prompt',
            name: 'System Prompt',
            description: 'Optional system prompt. Use {context_key} to interpolate context values.',
            type: 'string',
            isOptional: true,
        },
        {
            key: 'response_context_path',
            name: 'Response Context Path',
            description: 'Context key to store the LLM response.',
            type: 'string',
            default: 'llm_response',
        },
        {
            key: 'temperature',
            name: 'Temperature',
            description: 'Temperature for the LLM call (0.0–2.0).',
            type: 'float',
            isOptional: true,
        },
        {
            key: 'max_tokens',
            name: 'Max Tokens',
            description: 'Maximum number of tokens in the response.',
            type: 'int',
            isOptional: true,
        },
    ];

    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'LLM responded successfully.' },
        { status: ResultStatus.ERROR, description: 'LLM call failed.' },
    ];

    constructor() {
        super(
            'llm_chat',
            'LLM Chat',
            'Sends a prompt to an LLM and stores the response in context.',
            NodeCodeCategory.DATA,
        );
    }

    async process(context: Context): Promise<Result> {
        const capability = this.getRequiredConfigValue('capability', 'reason') as string;
        const promptTemplate = this.getRequiredConfigValue('prompt') as string;
        const systemPromptTemplate = this.getOptionalConfigValue('system_prompt') as string | null;
        const responseContextPath = this.getRequiredConfigValue('response_context_path', 'llm_response') as string;
        const temperature = this.getOptionalConfigValue('temperature') as number | null;
        const maxTokens = this.getOptionalConfigValue('max_tokens') as number | null;

        // Interpolate {context_key} in templates
        const prompt = this.interpolate(promptTemplate, context);
        const systemPrompt = systemPromptTemplate
            ? this.interpolate(systemPromptTemplate, context)
            : undefined;

        try {
            const llm = await getModelForCapability(capability as LLMCapability);

            const response = await llm.chat(
                [{ role: 'user' as const, content: prompt }],
                {
                    systemPrompt,
                    ...(temperature != null ? { temperature } : {}),
                    ...(maxTokens != null ? { maxTokens } : {}),
                },
            );

            context.set(responseContextPath, response.trim());

            return this.result(ResultStatus.OK, `LLM (${capability}) responded, stored in ${responseContextPath}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.result(ResultStatus.ERROR, `LLM (${capability}) failed: ${message}`);
        }
    }
}
