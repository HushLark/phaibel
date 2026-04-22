// ─────────────────────────────────────────────────────────────────────────────
// Feral Agent — OpenAI NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { AbstractNodeCode } from '../../node-code/abstract-node-code.js';
import { NodeCodeCategory } from '../../node-code/node-code.js';
import { ResultStatus } from '../../result/result.js';
/**
 * Calls an OpenAI-compatible chat completions API.
 * Interleaves system/user/assistant messages from context paths.
 */
export class OpenAiNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'api_key', name: 'API Key', description: 'OpenAI API key', type: 'string', isOptional: false, isSecret: true },
        { key: 'model', name: 'Model', description: 'Model identifier (e.g. gpt-4o)', type: 'string', isOptional: true, default: 'gpt-4o' },
        { key: 'system_context_path', name: 'System Prompt Path', description: 'Context path for the system message', type: 'string', isOptional: true, default: 'system_prompt' },
        { key: 'prompt_context_path', name: 'Prompt Path', description: 'Context path for the user prompt', type: 'string' },
        { key: 'response_context_path', name: 'Response Path', description: 'Context path to store the response', type: 'string', isOptional: true, default: 'ai_response' },
        { key: 'temperature', name: 'Temperature', description: 'Sampling temperature (0-2)', type: 'float', isOptional: true, default: 0.7 },
        { key: 'max_tokens', name: 'Max Tokens', description: 'Maximum tokens in the response', type: 'int', isOptional: true, default: 4096 },
        { key: 'base_url', name: 'Base URL', description: 'API base URL (for Perplexity, etc.)', type: 'string', isOptional: true },
    ];
    constructor() {
        super('open_ai', 'OpenAI Chat', 'Calls OpenAI-compatible chat completions API', NodeCodeCategory.DATA);
    }
    async process(context) {
        const apiKey = this.getRequiredConfigValue('api_key');
        const model = this.getOptionalConfigValue('model', 'gpt-4o');
        const systemPath = this.getOptionalConfigValue('system_context_path', 'system_prompt');
        const promptPath = this.getRequiredConfigValue('prompt_context_path');
        const responsePath = this.getOptionalConfigValue('response_context_path', 'ai_response');
        const temperature = Number(this.getOptionalConfigValue('temperature', 0.7));
        const maxTokens = Number(this.getOptionalConfigValue('max_tokens', 4096));
        const baseUrl = this.getOptionalConfigValue('base_url');
        if (!context.has(promptPath)) {
            return this.result(ResultStatus.ERROR, `No prompt at context path "${promptPath}"`);
        }
        const prompt = String(context.get(promptPath));
        // Build messages array
        const messages = [];
        if (context.has(systemPath)) {
            messages.push({ role: 'system', content: String(context.get(systemPath)) });
        }
        messages.push({ role: 'user', content: prompt });
        try {
            const { default: OpenAI } = await import('openai');
            const client = new OpenAI({
                apiKey,
                ...(baseUrl ? { baseURL: baseUrl } : {}),
            });
            const completion = await client.chat.completions.create({
                model,
                messages: messages,
                temperature,
                max_tokens: maxTokens,
            });
            const responseContent = completion.choices[0]?.message?.content ?? '';
            context.set(responsePath, responseContent);
            return this.result(ResultStatus.OK, `OpenAI ${model} response (${responseContent.length} chars)`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.result(ResultStatus.ERROR, `OpenAI error: ${message}`);
        }
    }
}
