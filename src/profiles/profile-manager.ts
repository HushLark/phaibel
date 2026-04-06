// ─────────────────────────────────────────────────────────────────────────────
// Profile Manager — Read/write user and Phaibel profiles
// ─────────────────────────────────────────────────────────────────────────────
// Profiles are stored as markdown files with YAML frontmatter in
// (Foundation)/profiles/. On first access, auto-migrates from v4 .state.json.
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { getProfilesDir } from '../paths.js';
import { findFoundationRoot } from '../state/manager.js';
import { debug } from '../utils/debug.js';
import type { UserProfile, PhaibelProfile } from './profile-types.js';

const USER_PROFILE_FILE = 'user-profile.md';
const PHAIBEL_PROFILE_FILE = 'phaibel-profile.md';

// ── Read ─────────────────────────────────────────────────────────────────────

export async function loadUserProfile(): Promise<UserProfile> {
    const dir = await getProfilesDir();
    const filepath = path.join(dir, USER_PROFILE_FILE);
    try {
        const raw = await fs.readFile(filepath, 'utf-8');
        const { data } = matter(raw);
        return data as UserProfile;
    } catch {
        // Try auto-migration from .state.json
        const migrated = await migrateFromStateJson();
        if (migrated) return migrated.user;
        return { name: 'User' };
    }
}

export async function loadPhaibelProfile(): Promise<PhaibelProfile> {
    const dir = await getProfilesDir();
    const filepath = path.join(dir, PHAIBEL_PROFILE_FILE);
    try {
        const raw = await fs.readFile(filepath, 'utf-8');
        const { data } = matter(raw);
        return data as PhaibelProfile;
    } catch {
        const migrated = await migrateFromStateJson();
        if (migrated) return migrated.phaibel;
        return { name: 'Agent', personality: 'butler' };
    }
}

// ── Write ────────────────────────────────────────────────────────────────────

export async function saveUserProfile(profile: UserProfile): Promise<void> {
    const dir = await getProfilesDir();
    await fs.mkdir(dir, { recursive: true });
    const filepath = path.join(dir, USER_PROFILE_FILE);

    const content = matter.stringify(buildUserProfileBody(profile), cleanMeta(profile));
    await fs.writeFile(filepath, content);
}

export async function savePhaibelProfile(profile: PhaibelProfile): Promise<void> {
    const dir = await getProfilesDir();
    await fs.mkdir(dir, { recursive: true });
    const filepath = path.join(dir, PHAIBEL_PROFILE_FILE);

    const body = `# ${profile.name}

Personality: ${profile.personality}

## Guardrails

- Do not assist with self-harm or illegal activities
- Phaibel is an organizational helper, not a tool for harmful purposes
- Redirect harmful requests to appropriate resources
- Maintain professional boundaries while being personable
`;

    const content = matter.stringify(body, cleanMeta(profile));
    await fs.writeFile(filepath, content);
}

// ── Migration from v4 .state.json ────────────────────────────────────────────

async function migrateFromStateJson(): Promise<{ user: UserProfile; phaibel: PhaibelProfile } | null> {
    const root = await findFoundationRoot();
    if (!root) return null;

    const stateFile = path.join(root, '.state.json');
    try {
        const raw = await fs.readFile(stateFile, 'utf-8');
        const state = JSON.parse(raw) as Record<string, unknown>;

        const user: UserProfile = {
            name: (state.userName as string) || 'User',
            gender: state.gender as UserProfile['gender'],
            homeLocation: state.cityLive as string | undefined,
            workLocation: state.cityWork as string | undefined,
            employer: undefined,
            workType: state.workType as string | undefined,
            familySituation: state.familySituation as string | undefined,
            hasCar: state.hasCar as boolean | undefined,
            personalCalUrl: state.personalCalUrl as string | undefined,
            workCalUrl: state.workCalUrl as string | undefined,
            interviewComplete: state.interviewComplete as boolean | undefined,
            lastUsed: state.lastUsed as string | undefined,
        };

        const phaibel: PhaibelProfile = {
            name: (state.agentName as string) || 'Agent',
            personality: (state.personality as PhaibelProfile['personality']) || 'butler',
            honorific: state.honorific as string | undefined,
        };

        // Write the new profile files
        await saveUserProfile(user);
        await savePhaibelProfile(phaibel);

        debug('profiles', `Migrated .state.json → profiles/`);
        return { user, phaibel };
    } catch {
        return null;
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildUserProfileBody(profile: UserProfile): string {
    const lines = [`# ${profile.name}`, ''];
    if (profile.homeLocation) lines.push(`Home: ${profile.homeLocation}`);
    if (profile.workLocation) lines.push(`Work: ${profile.workLocation}`);
    if (profile.employer) lines.push(`Employer: ${profile.employer}`);
    if (profile.workType) lines.push(`Role: ${profile.workType}`);
    if (profile.familySituation) lines.push(`Family: ${profile.familySituation}`);
    if (profile.currency) lines.push(`Currency: ${profile.currency}`);
    if (profile.language) lines.push(`Language: ${profile.language}`);
    if (profile.timezone) lines.push(`Timezone: ${profile.timezone}`);
    if (profile.beliefs) lines.push(`Beliefs: ${profile.beliefs}`);
    return lines.join('\n') + '\n';
}

function cleanMeta(obj: object): Record<string, unknown> {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined && value !== null) {
            clean[key] = value;
        }
    }
    return clean;
}
