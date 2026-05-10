import { loadSecrets, saveSecrets } from '../../config.js';
import type { LLMProvider, Message, ChatOptions } from '../types.js';

const DEFAULT_ENDPOINT = 'https://synaptic.hushlark.ai';

interface SynapticConfig {
    token: string;
    endpoint: string;
    refreshToken?: string;
}

export class SynapticProvider implements LLMProvider {
    name = 'synaptic';
    private capability: string;

    constructor(capability: string = 'chat') {
        this.capability = capability;
    }

    private async getConfig(): Promise<SynapticConfig> {
        const secrets = await loadSecrets();
        const cfg = secrets.providers['synaptic'] as {
            apiKey: string; endpoint?: string; refreshToken?: string;
        } | undefined;
        if (!cfg?.apiKey) {
            throw new Error("No Phaibel account configured. Run 'phaibel login' to connect.");
        }
        return {
            token: cfg.apiKey,
            endpoint: cfg.endpoint ?? DEFAULT_ENDPOINT,
            refreshToken: cfg.refreshToken,
        };
    }

    private async refreshAndSave(endpoint: string, refreshToken: string): Promise<string> {
        const res = await fetch(`${endpoint}/v1/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken }),
        });
        if (!res.ok) {
            throw new Error('Session expired. Please sign in again.');
        }
        const data = await res.json() as { access_token: string; refresh_token: string };
        const secrets = await loadSecrets();
        const existing = secrets.providers['synaptic'] as Record<string, string> ?? {};
        secrets.providers['synaptic'] = {
            ...existing,
            apiKey: data.access_token,
            refreshToken: data.refresh_token,
        };
        await saveSecrets(secrets);
        return data.access_token;
    }

    private buildBody(messages: Message[], options: ChatOptions): Record<string, unknown> {
        const systemMsg = options.systemPrompt ?? messages.find(m => m.role === 'system')?.content;
        const chatMessages = messages
            .filter(m => m.role !== 'system')
            .map(m => ({ role: m.role, content: m.content }));
        const body: Record<string, unknown> = {
            messages: chatMessages,
            max_tokens: options.maxTokens ?? 4096,
        };
        if (systemMsg) body.system = systemMsg;
        if (options.temperature !== undefined) body.temperature = options.temperature;
        return body;
    }

    async chat(messages: Message[], options: ChatOptions = {}): Promise<string> {
        let { token, endpoint, refreshToken } = await this.getConfig();

        const doRequest = async (t: string) => fetch(`${endpoint}/v1/phaibel/${this.capability}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` },
            body: JSON.stringify(this.buildBody(messages, options)),
        });

        let res = await doRequest(token);

        // On 401, attempt one token refresh and retry
        if (res.status === 401 && refreshToken) {
            token = await this.refreshAndSave(endpoint, refreshToken);
            res = await doRequest(token);
        }

        if (!res.ok) {
            const detail = await res.text().catch(() => res.statusText);
            throw new Error(`Synaptic error (${res.status}): ${detail}`);
        }

        const data = await res.json() as Record<string, unknown>;

        const content = data.content as Array<{ type: string; text: string }> | undefined;
        if (content?.[0]?.text) return content[0].text;

        const choices = data.choices as Array<{ message: { content: string } }> | undefined;
        if (choices?.[0]?.message?.content) return choices[0].message.content;

        throw new Error('Unexpected response format from Synaptic');
    }
}

export function createSynapticProvider(modelId?: string): LLMProvider {
    return new SynapticProvider(modelId);
}
