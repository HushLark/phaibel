// ─────────────────────────────────────────────────────────────────────────────
// LOCAL EMBEDDING PROVIDER
// Runs all-MiniLM-L6-v2 (384-dim) locally via @huggingface/transformers.
// No API key, no network calls after first model download (~23MB cached to
// ~/.cache/huggingface/hub/).
// ─────────────────────────────────────────────────────────────────────────────

import { debug } from '../../utils/debug.js';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const LOCAL_EMBED_DIMENSIONS = 384;
export const LOCAL_EMBED_MODEL = MODEL_ID;

type Pipeline = (texts: string[], options: Record<string, unknown>) => Promise<{ data: Float32Array }[]>;

let _pipeline: Pipeline | null = null;
let _loading: Promise<Pipeline> | null = null;

async function getPipeline(): Promise<Pipeline> {
    if (_pipeline) return _pipeline;
    if (_loading) return _loading;

    _loading = (async () => {
        debug('local-embed', `Loading model ${MODEL_ID}…`);
        const { pipeline } = await import('@huggingface/transformers');
        const pipe = await pipeline('feature-extraction', MODEL_ID, { dtype: 'fp32' });
        debug('local-embed', 'Model ready');
        _pipeline = pipe as unknown as Pipeline;
        return _pipeline;
    })();

    return _loading;
}

/**
 * Embed an array of texts locally. Returns one 384-dim vector per text.
 * Loads the model on first call (cached for the process lifetime).
 */
export async function localEmbed(texts: string[]): Promise<number[][]> {
    const pipe = await getPipeline();
    const outputs = await pipe(texts, { pooling: 'mean', normalize: true });
    return outputs.map(o => Array.from(o.data));
}
