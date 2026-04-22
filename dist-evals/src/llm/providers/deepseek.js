import OpenAI from 'openai';
import { getApiKey } from '../../config.js';
import { recordUsage } from '../token-usage.js';
export class DeepSeekProvider {
    name = 'deepseek';
    client = null;
    modelId;
    constructor(modelId = 'deepseek-chat') {
        this.modelId = modelId;
    }
    async getClient() {
        if (this.client) {
            return this.client;
        }
        const apiKey = await getApiKey('deepseek');
        if (!apiKey) {
            throw new Error("An API key for DeepSeek is needed. Please run 'phaibel config add-provider deepseek'");
        }
        this.client = new OpenAI({
            apiKey,
            baseURL: 'https://api.deepseek.com',
        });
        return this.client;
    }
    async chat(messages, options = {}) {
        const client = await this.getClient();
        const openaiMessages = [];
        if (options.systemPrompt) {
            openaiMessages.push({
                role: 'system',
                content: options.systemPrompt,
            });
        }
        for (const msg of messages) {
            openaiMessages.push({
                role: msg.role,
                content: msg.content,
            });
        }
        const response = await client.chat.completions.create({
            model: this.modelId,
            max_tokens: options.maxTokens || 4096,
            messages: openaiMessages,
        });
        if (response.usage) {
            recordUsage(this.modelId, response.usage.prompt_tokens, response.usage.completion_tokens).catch(() => { });
        }
        return response.choices[0]?.message?.content || '';
    }
}
export function createDeepSeekProvider(modelId) {
    return new DeepSeekProvider(modelId);
}
