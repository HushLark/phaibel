export interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface ChatOptions {
    maxTokens?: number;
    temperature?: number;
    systemPrompt?: string;
}

export interface EmbedOptions {
    dimensions?: number;
}

export interface LLMProvider {
    name: string;
    chat(messages: Message[], options?: ChatOptions): Promise<string>;
    embed?(texts: string[], options?: EmbedOptions): Promise<number[][]>;
}
