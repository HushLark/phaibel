import { loadSecrets, saveSecrets } from '../../config.js';
import { recordUsage } from '../token-usage.js';
import type { LLMProvider, Message, ChatOptions } from '../types.js';

const DEFAULT_ENDPOINT = 'https://synaptic.hushlark.ai';

// ── Registered authenticated fetch ──────────────────────────────────────────
// On mobile the app registers synapticFetch (which owns the refresh token
// singleton and deduplication).  All Synaptic HTTP calls go through it so
// concurrent 401s from different callers never race on the same refresh token.
// On Node.js this stays null and the provider uses its own refresh logic.

type AuthFetchFn = (path: string, options?: RequestInit) => Promise<Response>;
let _authFetch: AuthFetchFn | null = null;

export function registerSynapticFetch(fn: AuthFetchFn): void {
    _authFetch = fn;
}

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
        // Env override — lets headless callers (eval harness, CI) authenticate
        // as a dedicated Synaptic agent instead of the signed-in user, so their
        // usage/cost is attributed to the agent's account server-side.
        // Node-only: process.env doesn't exist on mobile.
        const env = typeof process !== 'undefined' ? process.env : undefined;
        if (env?.PHAIBEL_SYNAPTIC_API_KEY) {
            return {
                token: env.PHAIBEL_SYNAPTIC_API_KEY,
                endpoint: env.PHAIBEL_SYNAPTIC_ENDPOINT ?? DEFAULT_ENDPOINT,
                refreshToken: undefined,
            };
        }
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
        const path = `/v1/phaibel/${this.capability}`;
        const fetchOptions: RequestInit = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.buildBody(messages, options)),
        };

        // Use the registered auth fetch when available (mobile) — it owns the
        // refresh token singleton so concurrent 401s from LLM + transcription
        // never race each other.
        if (_authFetch) {
            let res = await _authFetch(path, fetchOptions);
            // Retry once on transient gateway errors
            if (res.status === 502 || res.status === 503) {
                await new Promise(r => setTimeout(r, 1500));
                res = await _authFetch(path, fetchOptions);
            }
            if (!res.ok) {
                if (res.status === 429) {
                    const body = await res.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
                    throw new Error(body.error === 'provider_rate_limited' ? 'provider_rate_limited' : 'rate_limited');
                }
                const detail = await res.text().catch(() => res.statusText);
                throw new Error(`Synaptic error (${res.status}): ${detail}`);
            }
            const data = await res.json() as Record<string, unknown>;
            this.trackUsage(data, messages, options);
            return this.parseResponse(data);
        }

        // Node.js fallback: own refresh logic (no mobile deduplication needed).
        let { token, endpoint, refreshToken } = await this.getConfig();
        const doRequest = async (t: string) => fetch(`${endpoint}${path}`, {
            ...fetchOptions,
            headers: { ...fetchOptions.headers as Record<string, string>, 'Authorization': `Bearer ${t}` },
        });

        let res = await doRequest(token);
        if (res.status === 401 && refreshToken) {
            token = await this.refreshAndSave(endpoint, refreshToken);
            res = await doRequest(token);
        }

        if (!res.ok) {
            if (res.status === 429) {
                const body = await res.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
                throw new Error(body.error === 'provider_rate_limited' ? 'provider_rate_limited' : 'rate_limited');
            }
            const detail = await res.text().catch(() => res.statusText);
            throw new Error(`Synaptic error (${res.status}): ${detail}`);
        }

        const data = await res.json() as Record<string, unknown>;
        this.trackUsage(data, messages, options);
        return this.parseResponse(data);
    }

    /**
     * Synaptic passes through the upstream provider response, which includes a
     * usage block (Anthropic or OpenAI shape) and usually the resolved model id.
     * Record it locally so per-chat token trackers (mobile UI, eval harness)
     * see real token counts and costs for synaptic-routed calls.
     */
    private trackUsage(data: Record<string, unknown>, messages: Message[], options: ChatOptions): void {
        try {
            const usage = data.usage as Record<string, number> | undefined;
            if (!usage) return;
            const inputTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0;
            const outputTokens = usage.output_tokens ?? usage.completion_tokens ?? 0;
            if (!inputTokens && !outputTokens) return;
            const model = typeof data.model === 'string' && data.model ? data.model : `synaptic:${this.capability}`;
            const chatMessages = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));
            let responseText = '';
            try { responseText = this.parseResponse(data); } catch { /* tracking only */ }
            recordUsage(model, inputTokens, outputTokens, { system: options.systemPrompt, messages: chatMessages }, responseText).catch(() => {});
        } catch {
            // Usage tracking must never break the chat path
        }
    }

    private parseResponse(data: Record<string, unknown>): string {
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
