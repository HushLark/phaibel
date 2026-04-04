// ─────────────────────────────────────────────────────────────────────────────
// Audio Transcription — Whisper API via OpenAI
// ─────────────────────────────────────────────────────────────────────────────

import OpenAI from 'openai';
import { getApiKey } from '../config.js';
import { debug } from '../utils/debug.js';

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
 * Transcribe an audio buffer using OpenAI's Whisper API.
 * Accepts webm/ogg/mp4/wav audio data.
 */
export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
    const client = await getClient();

    // The OpenAI SDK accepts a File-like object
    const file = new File([audioBuffer], 'audio.webm', { type: 'audio/webm' });

    const response = await client.audio.transcriptions.create({
        model: 'whisper-1',
        file,
        language: 'en',
    });

    debug('transcribe', `Transcribed: "${response.text}"`);
    return response.text;
}
