// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Web Search NodeCode
// Routes through Synaptic /v1/phaibel/search (subscription) or directly to
// Perplexity (BYOK). Both return the answer text which is stored in context.
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { loadSecrets } from '../../../config.js';

const PERPLEXITY_ENDPOINT = 'https://api.perplexity.ai/chat/completions';
const PERPLEXITY_MODEL    = 'sonar';

export class WebSearchNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        {
            key: 'query',
            name: 'Query',
            description: 'The search query. Supports {context_key} interpolation.',
            type: 'string',
        },
        {
            key: 'response_context_path',
            name: 'Response Path',
            description: 'Context key to store the search result text.',
            type: 'string',
            default: 'search_result',
        },
    ];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK,    description: 'Search completed — result stored in context.' },
        { status: ResultStatus.ERROR, description: 'Search failed — provider not configured or API error.' },
    ];

    constructor() {
        super(
            'web_search',
            'Web Search',
            'Searches the web for current factual data (weather, prices, news, flight status, exchange rates, etc.) via Perplexity.',
            NodeCodeCategory.DATA,
        );
    }

    async process(context: Context): Promise<Result> {
        const queryTemplate  = this.getRequiredConfigValue('query') as string;
        const responsePath   = this.getRequiredConfigValue('response_context_path', 'search_result') as string;
        const query          = this.interpolate(queryTemplate, context);

        if (!query.trim()) {
            return this.result(ResultStatus.ERROR, 'Query resolved to an empty string.');
        }

        const secrets       = await loadSecrets();
        const synapticCfg   = secrets.providers['synaptic'] as { apiKey?: string; endpoint?: string } | undefined;
        const perplexityCfg = secrets.providers['perplexity'] as { apiKey?: string } | undefined;

        const messages = [{ role: 'user', content: query }];

        try {
            let text: string;

            if (synapticCfg?.apiKey) {
                // Subscription path — model is determined server-side by the user's plan
                const endpoint = synapticCfg.endpoint ?? 'https://synaptic.hushlark.ai';
                const res = await fetch(`${endpoint}/v1/phaibel/search`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${synapticCfg.apiKey}`,
                    },
                    body: JSON.stringify({ messages }),
                });
                if (!res.ok) {
                    const detail = await res.text().catch(() => res.statusText);
                    return this.result(ResultStatus.ERROR, `Search error (${res.status}): ${detail}`);
                }
                text = parseSearchResponse(await res.json() as Record<string, unknown>);

            } else if (perplexityCfg?.apiKey) {
                // BYOK path — direct Perplexity API
                const res = await fetch(PERPLEXITY_ENDPOINT, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${perplexityCfg.apiKey}`,
                    },
                    body: JSON.stringify({ model: PERPLEXITY_MODEL, messages }),
                });
                if (!res.ok) {
                    const detail = await res.text().catch(() => res.statusText);
                    return this.result(ResultStatus.ERROR, `Perplexity error (${res.status}): ${detail}`);
                }
                text = parseSearchResponse(await res.json() as Record<string, unknown>);

            } else {
                return this.result(
                    ResultStatus.ERROR,
                    'No search provider configured. Add a Perplexity API key in Settings, or sign in with a Phaibel account.',
                );
            }

            context.set(responsePath, text);
            return this.result(ResultStatus.OK, `Web search complete (${text.length} chars)`);

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.result(ResultStatus.ERROR, `Web search failed: ${message}`);
        }
    }
}

function parseSearchResponse(data: Record<string, unknown>): string {
    // OpenAI-compatible choices array (Perplexity + Synaptic proxy)
    const choices = data.choices as Array<{ message: { content: string } }> | undefined;
    if (choices?.[0]?.message?.content) return choices[0].message.content;

    // Anthropic-style content array (fallback)
    const content = data.content as Array<{ type: string; text: string }> | undefined;
    if (content?.[0]?.text) return content[0].text;

    return JSON.stringify(data);
}
