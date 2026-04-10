import OpenAI from 'openai';
import { getApiKey } from '../../config.js';
import type { LLMProvider, Message, ChatOptions } from '../types.js';
import { recordUsage } from '../token-usage.js';

export class DeepSeekProvider implements LLMProvider {
    name = 'deepseek';
    private client: OpenAI | null = null;
    private modelId: string;

    constructor(modelId: string = 'deepseek-chat') {
        this.modelId = modelId;
    }

    private async getClient(): Promise<OpenAI> {
        if (this.client) {
            return this.client;
        }

        const apiKey = await getApiKey('deepseek');
        if (!apiKey) {
            throw new Error(
                "An API key for DeepSeek is needed. Please run 'phaibel config add-provider deepseek'"
            );
        }

        this.client = new OpenAI({
            apiKey,
            baseURL: 'https://api.deepseek.com',
        });
        return this.client;
    }

    async chat(messages: Message[], options: ChatOptions = {}): Promise<string> {
        const client = await this.getClient();

        const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

        if (options.systemPrompt) {
            openaiMessages.push({
                role: 'system',
                content: options.systemPrompt,
            });
        }

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

        if (response.usage) {
            recordUsage(this.modelId, response.usage.prompt_tokens, response.usage.completion_tokens).catch(() => {});
        }

        return response.choices[0]?.message?.content || '';
    }
}

export function createDeepSeekProvider(modelId?: string): LLMProvider {
    return new DeepSeekProvider(modelId);
}
