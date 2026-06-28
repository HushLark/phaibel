// ─────────────────────────────────────────────────────────────────────────────
// HTML → Markdown (lightweight, dependency-free)
// ─────────────────────────────────────────────────────────────────────────────
// Converts the *simple* HTML that shows up in calendar descriptions and similar
// content into Markdown, so the desktop/mobile Markdown renderer displays it
// correctly. Handles a safe subset — bold/italic/strike/code, links, headings,
// ul/ol lists, blockquotes, <pre>, <hr>, paragraphs/breaks, and basic tables —
// and strips anything else. Not a general-purpose parser; meant for tidy markup.

const ENTITIES: Record<string, string> = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
    '&apos;': "'", '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…',
};

function decode(s: string): string {
    return s
        .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCharCode(parseInt(n, 16)))
        .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

const stripTags = (s: string): string => s.replace(/<[^>]+>/g, '');

// Inline conversions: links, emphasis, code. Runs after block structure is set.
function inlineConvert(s: string): string {
    return s
        .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, txt) => `[${stripTags(txt).trim()}](${href})`)
        .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, txt) => `**${txt}**`)
        .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, txt) => `*${txt}*`)
        .replace(/<(del|s|strike)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, txt) => `~~${txt}~~`)
        .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, txt) => `\`${decode(stripTags(txt))}\``);
}

// Cell/inline text → single line of Markdown.
function cellText(html: string): string {
    return decode(stripTags(inlineConvert(html))).replace(/\s+/g, ' ').trim();
}

function convertList(inner: string, ordered: boolean): string {
    const items: string[] = [];
    const re = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let m: RegExpExecArray | null;
    let n = 1;
    while ((m = re.exec(inner)) !== null) {
        const text = inner ? m[1] : '';
        const line = text.replace(/\s+/g, ' ').trim();
        items.push(`${ordered ? `${n++}.` : '-'} ${line}`);
    }
    return items.join('\n');
}

function convertTable(tbl: string): string {
    const rows: string[][] = [];
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let tr: RegExpExecArray | null;
    while ((tr = trRe.exec(tbl)) !== null) {
        const cells: string[] = [];
        const cellRe = /<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi;
        let c: RegExpExecArray | null;
        while ((c = cellRe.exec(tr[1])) !== null) {
            cells.push(cellText(c[2]).replace(/\|/g, '\\|'));
        }
        if (cells.length) rows.push(cells);
    }
    if (rows.length === 0) return '';
    const cols = Math.max(...rows.map(r => r.length));
    const pad = (r: string[]) => { while (r.length < cols) r.push(''); return r; };
    const header = pad(rows[0]);
    const sep = Array(cols).fill('---');
    const body = rows.slice(1).map(pad);
    const fmt = (r: string[]) => `| ${r.join(' | ')} |`;
    return ['', fmt(header), fmt(sep), ...body.map(fmt), ''].join('\n');
}

export function htmlToMarkdown(html: string): string {
    if (!html) return '';
    // Quick out: nothing that looks like a tag → just decode + tidy.
    let s = html;
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');

    s = s.replace(/<table[\s\S]*?<\/table>/gi, (t) => convertTable(t));

    s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, lvl, inner) => `\n\n${'#'.repeat(Math.min(3, Number(lvl)))} ${inner.replace(/\s+/g, ' ').trim()}\n\n`);

    s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner) => `\n\n> ${stripTags(inlineConvert(inner)).replace(/\s+/g, ' ').trim()}\n\n`);

    s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner) => `\n\n\`\`\`\n${decode(stripTags(inner))}\n\`\`\`\n\n`);

    s = s.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_m, inner) => `\n${convertList(inner, false)}\n`);
    s = s.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m, inner) => `\n${convertList(inner, true)}\n`);

    s = s.replace(/<hr\s*\/?>/gi, '\n\n---\n\n');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<\/(p|div)>/gi, '\n\n');
    s = s.replace(/<(p|div)[^>]*>/gi, '');

    s = inlineConvert(s);
    s = stripTags(s);
    s = decode(s);

    return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
