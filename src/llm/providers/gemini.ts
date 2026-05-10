import OpenAI from 'openai';
import { getApiKey } from '../../config.js';
import type { LLMProvider, Message, ChatOptions } from '../types.js';
import { recordUsage } from '../token-usage.js';

export class GeminiProvider implements LLMProvider {
    name = 'google';
    private client: OpenAI | null = null;
    private modelId: string;

    constructor(modelId: string = 'gemini-2.5-flash') {
        this.modelId = modelId;
    }

    private async getClient(): Promise<OpenAI> {
        if (this.client) {
            return this.client;
        }

        const apiKey = await getApiKey('google');
        if (!apiKey) {
            throw new Error(
                "A Google AI API key is needed. Please run 'phaibel config add-provider google'"
            );
        }

        this.client = new OpenAI({
            apiKey,
            baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
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

        const responseText = response.choices[0]?.message?.content || '';

        if (response.usage) {
            const sys = openaiMessages.find(m => m.role === 'system');
            const nonSys = openaiMessages.filter(m => m.role !== 'system') as { role: string; content: string }[];
            recordUsage(
                this.modelId,
                response.usage.prompt_tokens,
                response.usage.completion_tokens,
                { system: typeof sys?.content === 'string' ? sys.content : undefined, messages: nonSys },
                responseText,
            ).catch(() => {});
        }

        return responseText;
    }
}

export function createGeminiProvider(modelId?: string): LLMProvider {
    return new GeminiProvider(modelId);
}
