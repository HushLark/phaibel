import type { LLMProvider } from '../types.js';
import { createClaudeProvider } from './claude.js';
import { createDeepSeekProvider } from './deepseek.js';
import { createOpenAIProvider } from './openai.js';

const providers: Map<string, (modelId?: string) => LLMProvider> = new Map();

// Register built-in providers
providers.set('anthropic', createClaudeProvider);
providers.set('deepseek', createDeepSeekProvider);
providers.set('openai', createOpenAIProvider);

export function registerProvider(
    name: string,
    factory: (modelId?: string) => LLMProvider
): void {
    providers.set(name, factory);
}

export function getProvider(name: string, modelId?: string): LLMProvider {
    const factory = providers.get(name);
    if (!factory) {
        throw new Error(`Unknown LLM provider: ${name}. This provider is not registered.`);
    }
    return factory(modelId);
}

export function listProviders(): string[] {
    return Array.from(providers.keys());
}
