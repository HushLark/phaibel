// ─────────────────────────────────────────────────────────────────────────────
// Phaibel blocks → Markdown (graceful fallback)
// ─────────────────────────────────────────────────────────────────────────────
// Renders a block array as Markdown for surfaces that don't have the rich block
// renderer (e.g. the mobile chat, which renders Markdown). Interactive action
// buttons can't exist in plain Markdown, so they're listed as a context line.

interface AnyBlock {
    type?: string;
    text?: string;
    level?: number;
    items?: Array<{ label?: string; value?: string } | string>;
    ordered?: boolean;
    actions?: Array<{ label?: string }>;
}

export function blocksToMarkdown(blocks: unknown[]): string {
    const out: string[] = [];
    for (const raw of blocks) {
        const b = (raw ?? {}) as AnyBlock;
        switch (b.type) {
            case 'markdown':
                out.push(b.text ?? '');
                break;
            case 'heading':
                out.push(`${'#'.repeat(Math.min(3, b.level ?? 2))} ${b.text ?? ''}`);
                break;
            case 'context':
                out.push(`_${b.text ?? ''}_`);
                break;
            case 'divider':
                out.push('---');
                break;
            case 'fields':
                for (const f of b.items ?? []) {
                    if (f && typeof f === 'object') out.push(`**${f.label ?? ''}:** ${f.value ?? ''}`);
                }
                break;
            case 'list':
                (b.items ?? []).forEach((it, i) => {
                    const text = typeof it === 'string' ? it : '';
                    out.push(`${b.ordered ? `${i + 1}.` : '-'} ${text}`);
                });
                break;
            case 'actions': {
                const labels = (b.actions ?? []).map(a => a?.label).filter(Boolean);
                if (labels.length) out.push(`_Actions: ${labels.join(' · ')}_`);
                break;
            }
            default:
                if (b.text) out.push(b.text);
        }
    }
    return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}
