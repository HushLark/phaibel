import Anthropic from '@anthropic-ai/sdk';
import { getApiKey } from '../../config.js';
import type { LLMProvider, Message, ChatOptions } from '../types.js';
import { recordUsage } from '../token-usage.js';

export class ClaudeProvider implements LLMProvider {
    name = 'anthropic';
    private client: Anthropic | null = null;
    private modelId: string;

    constructor(modelId: string = 'claude-sonnet-4-6') {
        this.modelId = modelId;
    }

    private async getClient(): Promise<Anthropic> {
        if (this.client) {
            return this.client;
        }

        const apiKey = await getApiKey('anthropic');
        if (!apiKey) {
            throw new Error(
                "An Anthropic API key is needed. Please run 'phaibel config add-provider anthropic'"
            );
        }

        this.client = new Anthropic({ apiKey });
        return this.client;
    }

    async chat(messages: Message[], options: ChatOptions = {}): Promise<string> {
        const client = await this.getClient();

        // Separate system prompt from messages
        const systemPrompt = options.systemPrompt || messages.find(m => m.role === 'system')?.content;
        const chatMessages = messages
            .filter(m => m.role !== 'system')
            .map(m => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
            }));

        const response = await client.messages.create({
            model: this.modelId,
            max_tokens: options.maxTokens || 4096,
            system: systemPrompt,
            messages: chatMessages,
        });

        // Extract text from response
        const textBlock = response.content.find(block => block.type === 'text');
        const responseText = textBlock?.text || '';

        // Track token usage
        if (response.usage) {
            recordUsage(
                this.modelId,
                response.usage.input_tokens,
                response.usage.output_tokens,
                { system: systemPrompt, messages: chatMessages },
                responseText,
            ).catch(() => {});
        }

        return responseText;
    }
}

export function createClaudeProvider(modelId?: string): LLMProvider {
    return new ClaudeProvider(modelId);
}
