import OpenAI from 'openai';
import { getApiKey } from '../../config.js';
import type { LLMProvider, Message, ChatOptions, EmbedOptions } from '../types.js';
import { recordUsage } from '../token-usage.js';

export class OpenAIProvider implements LLMProvider {
    name = 'openai';
    private client: OpenAI | null = null;
    private modelId: string;

    constructor(modelId: string = 'gpt-4o') {
        this.modelId = modelId;
    }

    private async getClient(): Promise<OpenAI> {
        if (this.client) {
            return this.client;
        }

        const apiKey = await getApiKey('openai');
        if (!apiKey) {
            throw new Error(
                "An API key for OpenAI is needed. Please run 'phaibel config add-provider openai'"
            );
        }

        this.client = new OpenAI({ apiKey });
        return this.client;
    }

    async chat(messages: Message[], options: ChatOptions = {}): Promise<string> {
        const client = await this.getClient();

        // Convert messages to OpenAI format
        const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

        // Add system prompt if provided
        if (options.systemPrompt) {
            openaiMessages.push({
                role: 'system',
                content: options.systemPrompt,
            });
        }

        // Add other messages
        for (const msg of messages) {
            openaiMessages.push({
                role: msg.role as 'user' | 'assistant' | 'system',
                content: msg.content,
            });
        }

        const response = await client.chat.completions.create({
            model: this.modelId,
            max_tokens: options.maxTokens || 4096,
            messages: openaiMessages,
        });

        // Track token usage
        if (response.usage) {
            recordUsage(this.modelId, response.usage.prompt_tokens, response.usage.completion_tokens).catch(() => {});
        }

        return response.choices[0]?.message?.content || '';
    }

    async embed(texts: string[], options: EmbedOptions = {}): Promise<number[][]> {
        const client = await this.getClient();

        const response = await client.embeddings.create({
            model: this.modelId,
            input: texts,
            ...(options.dimensions ? { dimensions: options.dimensions } : {}),
        });

        // Track embedding token usage
        if (response.usage) {
            recordUsage(this.modelId, response.usage.prompt_tokens, 0).catch(() => {});
        }

        // Sort by index to maintain input order
        return response.data
            .sort((a, b) => a.index - b.index)
            .map(item => item.embedding);
    }
}

export function createOpenAIProvider(modelId?: string): LLMProvider {
    return new OpenAIProvider(modelId);
}
