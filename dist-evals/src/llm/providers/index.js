import { createClaudeProvider } from './claude.js';
import { createDeepSeekProvider } from './deepseek.js';
import { createGeminiProvider } from './gemini.js';
import { createOpenAIProvider } from './openai.js';
const providers = new Map();
// Register built-in providers
providers.set('anthropic', createClaudeProvider);
providers.set('deepseek', createDeepSeekProvider);
providers.set('google', createGeminiProvider);
providers.set('openai', createOpenAIProvider);
export function registerProvider(name, factory) {
    providers.set(name, factory);
}
export function getProvider(name, modelId) {
    const factory = providers.get(name);
    if (!factory) {
        throw new Error(`Unknown LLM provider: ${name}. This provider is not registered.`);
    }
    return factory(modelId);
}
export function listProviders() {
    return Array.from(providers.keys());
}
