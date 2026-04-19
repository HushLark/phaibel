// ─────────────────────────────────────────────────────────────────────────────
// Big Five Personality Observation Framework
//
// Observation-only personality scoring for both user and robot (Phaibel).
// After each interaction the LLM rates both parties on the Big Five traits.
// Scores are stored as samples and aggregated into a running profile using
// exponential moving averages. The profile is fed back into the system prompt
// so Phaibel adapts its behavior over time.
//
// Traits (1-5 scale):
//   Extraversion · Conscientiousness · Agreeableness · Openness · Emotional Stability
// ─────────────────────────────────────────────────────────────────────────────

import { getPlatform } from '../platform/index.js';
import { getVaultConfigDir } from '../paths.js';
import { debug } from '../utils/debug.js';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface BigFiveScores {
    extraversion: number;         // 1-5
    conscientiousness: number;
    agreeableness: number;
    openness: number;
    emotionalStability: number;
}

export interface BigFiveSample {
    timestamp: string;            // ISO 8601
    chatId: string;
    user: BigFiveScores;
    robot: BigFiveScores;
}

export interface BigFiveProfile {
    sampleCount: number;
    lastUpdated: string;
    user: BigFiveScores;          // running EMA
    robot: BigFiveScores;         // running EMA
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** EMA smoothing factor. α=0.1 means ~10 recent interactions dominate. */
const ALPHA = 0.1;

const TRAIT_KEYS: (keyof BigFiveScores)[] = [
    'extraversion',
    'conscientiousness',
    'agreeableness',
    'openness',
    'emotionalStability',
];

const DEFAULT_SCORES: BigFiveScores = {
    extraversion: 3,
    conscientiousness: 3,
    agreeableness: 3,
    openness: 3,
    emotionalStability: 3,
};

// ─────────────────────────────────────────────────────────────────────────────
// FILE PATHS
// ─────────────────────────────────────────────────────────────────────────────

async function getProfilePath(): Promise<string> {
    return getPlatform().paths.join(await getVaultConfigDir(), 'personality-profile.json');
}

async function getSamplesPath(): Promise<string> {
    return getPlatform().paths.join(await getVaultConfigDir(), 'personality-samples.jsonl');
}

// ─────────────────────────────────────────────────────────────────────────────
// LOAD / SAVE
// ─────────────────────────────────────────────────────────────────────────────

export async function loadProfile(): Promise<BigFiveProfile | null> {
    try {
        const raw = await getPlatform().storage.readFile(await getProfilePath());
        return JSON.parse(raw) as BigFiveProfile;
    } catch {
        return null;
    }
}

async function saveProfile(profile: BigFiveProfile): Promise<void> {
    const { storage } = getPlatform();
    const dir = await getVaultConfigDir();
    await storage.mkdir(dir, { recursive: true });
    await storage.writeFile(await getProfilePath(), JSON.stringify(profile, null, 2));
}

async function appendSample(sample: BigFiveSample): Promise<void> {
    const { storage } = getPlatform();
    const dir = await getVaultConfigDir();
    await storage.mkdir(dir, { recursive: true });
    const samplesPath = await getSamplesPath();
    let existing = '';
    try { existing = await storage.readFile(samplesPath); } catch { /* new file */ }
    await storage.writeFile(samplesPath, existing + JSON.stringify(sample) + '\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

/**
 * Validate and clamp raw scores from LLM output.
 * Returns null if the data is completely unusable.
 */
export function validateScores(raw: unknown): BigFiveScores | null {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;

    const scores: Partial<BigFiveScores> = {};
    let validCount = 0;

    for (const key of TRAIT_KEYS) {
        const val = obj[key];
        if (typeof val === 'number' && !isNaN(val)) {
            scores[key] = clamp(Math.round(val), 1, 5);
            validCount++;
        } else {
            scores[key] = 3; // default to moderate if missing
        }
    }

    // Need at least 3 valid traits to accept the sample
    if (validCount < 3) return null;

    return scores as BigFiveScores;
}

// ─────────────────────────────────────────────────────────────────────────────
// STATISTICS — Exponential Moving Average
// ─────────────────────────────────────────────────────────────────────────────

function emaScores(current: BigFiveScores, newSample: BigFiveScores): BigFiveScores {
    const result = { ...current };
    for (const key of TRAIT_KEYS) {
        result[key] = ALPHA * newSample[key] + (1 - ALPHA) * current[key];
        // Round to 1 decimal for readability
        result[key] = Math.round(result[key] * 10) / 10;
    }
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE — Record a sample and recompute the profile
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record a new observation sample and update the running profile.
 * Safe to call fire-and-forget.
 */
export async function updateProfile(sample: BigFiveSample): Promise<void> {
    try {
        await appendSample(sample);

        const existing = await loadProfile();

        let profile: BigFiveProfile;
        if (!existing || existing.sampleCount === 0) {
            // First sample — use raw scores
            profile = {
                sampleCount: 1,
                lastUpdated: sample.timestamp,
                user: sample.user,
                robot: sample.robot,
            };
        } else {
            // EMA update
            profile = {
                sampleCount: existing.sampleCount + 1,
                lastUpdated: sample.timestamp,
                user: emaScores(existing.user, sample.user),
                robot: emaScores(existing.robot, sample.robot),
            };
        }

        await saveProfile(profile);
        debug('big-five', `Profile updated (sample #${profile.sampleCount})`);
    } catch (err) {
        debug('big-five', `Failed to update profile: ${err}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTING — for LLM system prompt injection
// ─────────────────────────────────────────────────────────────────────────────

const TRAIT_LABELS: Record<keyof BigFiveScores, string> = {
    extraversion: 'Extraversion',
    conscientiousness: 'Conscientiousness',
    agreeableness: 'Agreeableness',
    openness: 'Openness to Experience',
    emotionalStability: 'Emotional Stability',
};

function formatScores(scores: BigFiveScores): string {
    return TRAIT_KEYS.map(key =>
        `- ${TRAIT_LABELS[key]}: ${scores[key].toFixed(1)}/5`
    ).join('\n');
}

/**
 * Format the personality profile as a text block for the system prompt.
 * Returns empty string if no profile exists yet.
 */
export function formatProfileBlock(profile: BigFiveProfile | null): string {
    if (!profile || profile.sampleCount === 0) return '';

    return `PERSONALITY PROFILE (observation-based, evolving over ${profile.sampleCount} interactions):
User traits:
${formatScores(profile.user)}

Your traits (self-observation):
${formatScores(profile.robot)}

Use these profiles to calibrate your tone and approach. A low-agreeableness user prefers directness over suggestions. A high-openness user welcomes novel ideas. A high-conscientiousness user values precision and follow-through.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CACHE — for efficient access from the system prompt builder
// ─────────────────────────────────────────────────────────────────────────────

let _cachedProfile: BigFiveProfile | null = null;
let _cacheLoadedAt = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get the current personality profile with caching.
 * Refreshes from disk at most every 5 minutes.
 */
export async function getCachedProfile(): Promise<BigFiveProfile | null> {
    const now = Date.now();
    if (_cachedProfile && (now - _cacheLoadedAt) < CACHE_TTL) {
        return _cachedProfile;
    }
    _cachedProfile = await loadProfile();
    _cacheLoadedAt = now;
    return _cachedProfile;
}

/** Force-refresh the cache (called after updating the profile). */
export function invalidateProfileCache(): void {
    _cacheLoadedAt = 0;
}
