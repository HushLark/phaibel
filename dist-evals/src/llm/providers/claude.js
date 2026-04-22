import Anthropic from '@anthropic-ai/sdk';
import { getApiKey } from '../../config.js';
import { recordUsage } from '../token-usage.js';
export class ClaudeProvider {
    name = 'anthropic';
    client = null;
    modelId;
    constructor(modelId = 'claude-sonnet-4-6') {
        this.modelId = modelId;
    }
    async getClient() {
        if (this.client) {
            return this.client;
        }
        const apiKey = await getApiKey('anthropic');
        if (!apiKey) {
            throw new Error("An Anthropic API key is needed. Please run 'phaibel config add-provider anthropic'");
        }
        this.client = new Anthropic({ apiKey });
        return this.client;
    }
    async chat(messages, options = {}) {
        const client = await this.getClient();
        // Separate system prompt from messages
        const systemPrompt = options.systemPrompt || messages.find(m => m.role === 'system')?.content;
        const chatMessages = messages
            .filter(m => m.role !== 'system')
            .map(m => ({
            role: m.role,
            content: m.content,
        }));
        const response = await client.messages.create({
            model: this.modelId,
            max_tokens: options.maxTokens || 4096,
            system: systemPrompt,
            messages: chatMessages,
        });
        // Track token usage
        if (response.usage) {
            recordUsage(this.modelId, response.usage.input_tokens, response.usage.output_tokens).catch(() => { });
        }
        // Extract text from response
        const textBlock = response.content.find(block => block.type === 'text');
        return textBlock?.text || '';
    }
}
export function createClaudeProvider(modelId) {
    return new ClaudeProvider(modelId);
}
