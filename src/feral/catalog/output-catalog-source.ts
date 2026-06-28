// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Output Catalog Source
// ─────────────────────────────────────────────────────────────────────────────
//
// Auto-generates a speak_* CatalogNode for every ResponseKey.
// Each node binds the agent_speak NodeCode with a specific response_key.
// ─────────────────────────────────────────────────────────────────────────────

import type { CatalogNode } from './catalog-node.js';
import responses from '../../responses.js';

// All response keys from the catalog
const RESPONSE_KEYS = Object.keys(responses) as string[];

function humanize(key: string): string {
    return key
        .split('_')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

export class OutputCatalogSource {
    getCatalogNodes(): CatalogNode[] {
        const nodes: CatalogNode[] = RESPONSE_KEYS.map(key => ({
            key: `speak_${key}`,
            nodeCodeKey: 'agent_speak',
            name: `Speak — ${humanize(key)}`,
            group: 'output',
            description: `Outputs a random "${key}" response with token replacement.`,
            configuration: {
                response_key: key,
                context_path: 'output',
            },
        }));

        // Rich block UI output — markdown text, fields, lists, and action buttons.
        nodes.push({
            key: 'emit_blocks',
            nodeCodeKey: 'emit_blocks',
            name: 'Emit Blocks (rich UI)',
            group: 'output',
            description: 'Renders a rich block message into the chat: markdown text, fields, lists, dividers, and action buttons. '
                + 'Configure `blocks` with a JSON array. Each block has a `type`: '
                + '"markdown" {text}, "heading" {text,level}, "context" {text}, "divider", '
                + '"fields" {items:[{label,value}]}, "list" {ordered?,items:[…]}, or '
                + '"actions" {actions:[{id,label,style?,kind,payload?}]}. Action `kind` is dispatched client-side '
                + '("record", "completeTask", or "runProcess" with payload {process,args} to run another Feral process).',
            configuration: {
                blocks: '[]',
            },
        });

        // Normalize simple HTML (calendar descriptions, etc.) to Markdown before
        // it's rendered/emitted as Markdown or blocks.
        nodes.push({
            key: 'html_to_markdown',
            nodeCodeKey: 'html_to_markdown',
            name: 'HTML → Markdown',
            group: 'transform',
            description: 'Converts simple HTML (bold, italic, links, ul/ol lists, tables, headings, blockquotes) in a context value into Markdown. Use before emitting content as Markdown or blocks so it renders correctly. Configure `source` (context key) and optional `context_path` (output key).',
            configuration: {
                source: 'content',
                context_path: 'content',
            },
        });

        return nodes;
    }
}
