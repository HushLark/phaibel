// ─────────────────────────────────────────────────────────────────────────────
// Feral Agent — Catalog Source
// ─────────────────────────────────────────────────────────────────────────────

import type { CatalogSource } from './catalog.js';
import type { CatalogNode } from './catalog-node.js';
import { createCatalogNode } from './catalog-node.js';

/**
 * Provides pre-configured CatalogNodes for the Agent module.
 */
export class AgentCatalogSource implements CatalogSource {
    getCatalogNodes(): CatalogNode[] {
        return [
            // OpenAI variants
            createCatalogNode({
                key: 'open_ai_4o',
                nodeCodeKey: 'open_ai',
                name: 'OpenAI GPT-4o',
                group: 'genai',
                description: 'Call OpenAI GPT-4o',
                configuration: { model: 'gpt-4o' },
            }),
            createCatalogNode({
                key: 'open_ai_4o_mini',
                nodeCodeKey: 'open_ai',
                name: 'OpenAI GPT-4o Mini',
                group: 'genai',
                description: 'Call OpenAI GPT-4o Mini',
                configuration: { model: 'gpt-4o-mini' },
            }),
            createCatalogNode({
                key: 'open_ai_o1',
                nodeCodeKey: 'open_ai',
                name: 'OpenAI o1',
                group: 'genai',
                description: 'Call OpenAI o1',
                configuration: { model: 'o1' },
            }),
            // Perplexity variants
            createCatalogNode({
                key: 'perplexity_sonar',
                nodeCodeKey: 'open_ai',
                name: 'Perplexity Sonar',
                group: 'genai',
                description: 'Search the web for real-time information (flight status, product details, news, facts, prices, current events). Use when the user mentions a flight number, URL, or needs live data not in the vault.',
                configuration: { model: 'sonar', base_url: 'https://api.perplexity.ai' },
            }),
            // Data synthesis
            createCatalogNode({
                key: 'merge_strings',
                nodeCodeKey: 'merge_strings',
                name: 'Merge Strings',
                group: 'genai',
                description: 'Concatenate context strings',
            }),
            createCatalogNode({
                key: 'synthesis_prep',
                nodeCodeKey: 'synthesis_prep',
                name: 'Data Synthesis Prep',
                group: 'genai',
                description: 'Prepare data for LLM synthesis',
            }),
            // Model interaction
            createCatalogNode({
                key: 'model_to_json',
                nodeCodeKey: 'model_to_output',
                name: 'Model to JSON',
                group: 'genai',
                description: 'Generate prompt from model schema',
            }),
            createCatalogNode({
                key: 'hydrate_model',
                nodeCodeKey: 'hydrate_model',
                name: 'Hydrate Model',
                group: 'genai',
                description: 'Extract and validate model from LLM response',
            }),
            // File I/O
            createCatalogNode({
                key: 'write_file',
                nodeCodeKey: 'write_file',
                name: 'Write File',
                group: 'genai',
                description: 'Write context value to file',
            }),
            createCatalogNode({
                key: 'generate_markdown',
                nodeCodeKey: 'generate_markdown',
                name: 'Generate Markdown',
                group: 'genai',
                description: 'Generate Markdown from structured data',
            }),
            createCatalogNode({
                key: 'convert_html',
                nodeCodeKey: 'convert_html',
                name: 'Convert to HTML',
                group: 'genai',
                description: 'Convert Markdown to HTML',
            }),
            // Infrastructure
            createCatalogNode({
                key: 'write_entity',
                nodeCodeKey: 'write_entity',
                name: 'Write Entity',
                group: 'genai',
                description: 'Persist entity via EntityPersister',
            }),
            createCatalogNode({
                key: 'write_redis',
                nodeCodeKey: 'write_redis',
                name: 'Write to Key-Value Store',
                group: 'genai',
                description: 'Write value to key-value store',
            }),
        ];
    }
}
