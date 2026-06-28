// ─────────────────────────────────────────────────────────────────────────────
// Audio Transcription
// ─────────────────────────────────────────────────────────────────────────────
// Prefers the HushLark account (synaptic) so dictation uses the customer's shared
// credits — same as chat. Falls back to a BYOK OpenAI key only when no synaptic
// account is configured.

import OpenAI from 'openai';
import { getApiKey, loadSecrets, saveSecrets } from '../config.js';
import { debug } from '../utils/debug.js';

const DEFAULT_ENDPOINT = 'https://synaptic.hushlark.ai';

let _client: OpenAI | null = null;

async function getClient(): Promise<OpenAI> {
    if (_client) return _client;
    const apiKey = await getApiKey('openai');
    if (!apiKey) {
        throw new Error('An OpenAI API key is needed for audio transcription.');
    }
    _client = new OpenAI({ apiKey });
    return _client;
}

/**
 * Transcribe via synaptic's Whisper proxy (POST /v1/phaibel/transcribe), billed
 * to the customer's HushLark credits. Returns null if no synaptic account is
 * configured so the caller can fall back to BYOK OpenAI.
 */
async function transcribeViaSynaptic(audioBuffer: Buffer): Promise<string | null> {
    const secrets = await loadSecrets();
    const cfg = secrets.providers['synaptic'] as { apiKey?: string; endpoint?: string; refreshToken?: string } | undefined;
    if (!cfg?.apiKey) return null;

    const endpoint = (cfg.endpoint ?? DEFAULT_ENDPOINT).replace(/\/$/, '');
    let token = cfg.apiKey;

    const doRequest = (t: string) => {
        const form = new FormData();
        form.append('file', new Blob([audioBuffer], { type: 'audio/webm' }), 'audio.webm');
        form.append('language', 'en');
        return fetch(`${endpoint}/v1/phaibel/transcribe`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${t}` },
            body: form,
        });
    };

    let res = await doRequest(token);
    if (res.status === 401 && cfg.refreshToken) {
        const rr = await fetch(`${endpoint}/v1/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: cfg.refreshToken }),
        });
        if (rr.ok) {
            const data = await rr.json() as { access_token: string; refresh_token: string };
            token = data.access_token;
            const s2 = await loadSecrets();
            s2.providers['synaptic'] = { ...(s2.providers['synaptic'] as Record<string, string>), apiKey: data.access_token, refreshToken: data.refresh_token };
            await saveSecrets(s2);
            res = await doRequest(token);
        }
    }

    if (!res.ok) {
        const detail = await res.text().catch(() => res.statusText);
        throw new Error(`Synaptic transcription failed (${res.status}): ${detail}`);
    }
    const data = await res.json() as { text?: string };
    return data.text ?? '';
}

/**
 * Transcribe an audio buffer (webm/ogg/mp4/wav).
 * Uses synaptic/HushLark credits when signed in; otherwise BYOK OpenAI Whisper.
 */
export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
    const viaSynaptic = await transcribeViaSynaptic(audioBuffer);
    if (viaSynaptic !== null) {
        debug('transcribe', `Synaptic transcribed: "${viaSynaptic}"`);
        return viaSynaptic;
    }

    // No HushLark account — fall back to a user-supplied OpenAI key.
    const client = await getClient();
    const file = new File([audioBuffer], 'audio.webm', { type: 'audio/webm' });
    const response = await client.audio.transcriptions.create({
        model: 'whisper-1',
        file,
        language: 'en',
    });
    debug('transcribe', `Transcribed: "${response.text}"`);
    return response.text;
}
