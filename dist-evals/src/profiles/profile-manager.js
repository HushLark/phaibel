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
const USER_PROFILE_FILE = 'user-profile.md';
const PHAIBEL_PROFILE_FILE = 'phaibel-profile.md';
// ── Read ─────────────────────────────────────────────────────────────────────
export async function loadUserProfile() {
    const dir = await getProfilesDir();
    const filepath = path.join(dir, USER_PROFILE_FILE);
    try {
        const raw = await fs.readFile(filepath, 'utf-8');
        const { data } = matter(raw);
        return data;
    }
    catch {
        // Try auto-migration from .state.json
        const migrated = await migrateFromStateJson();
        if (migrated)
            return migrated.user;
        return { name: 'User' };
    }
}
export async function loadPhaibelProfile() {
    const dir = await getProfilesDir();
    const filepath = path.join(dir, PHAIBEL_PROFILE_FILE);
    try {
        const raw = await fs.readFile(filepath, 'utf-8');
        const { data } = matter(raw);
        return data;
    }
    catch {
        const migrated = await migrateFromStateJson();
        if (migrated)
            return migrated.phaibel;
        return { name: 'Agent', personality: 'butler' };
    }
}
// ── Write ────────────────────────────────────────────────────────────────────
export async function saveUserProfile(profile) {
    const dir = await getProfilesDir();
    await fs.mkdir(dir, { recursive: true });
    const filepath = path.join(dir, USER_PROFILE_FILE);
    const content = matter.stringify(buildUserProfileBody(profile), cleanMeta(profile));
    await fs.writeFile(filepath, content);
}
export async function savePhaibelProfile(profile) {
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
async function migrateFromStateJson() {
    const root = await findFoundationRoot();
    if (!root)
        return null;
    const stateFile = path.join(root, '.state.json');
    try {
        const raw = await fs.readFile(stateFile, 'utf-8');
        const state = JSON.parse(raw);
        const user = {
            name: state.userName || 'User',
            gender: state.gender,
            homeLocation: state.cityLive,
            workLocation: state.cityWork,
            employer: undefined,
            workType: state.workType,
            familySituation: state.familySituation,
            hasCar: state.hasCar,
            personalCalUrl: state.personalCalUrl,
            workCalUrl: state.workCalUrl,
            interviewComplete: state.interviewComplete,
            lastUsed: state.lastUsed,
        };
        const phaibel = {
            name: state.agentName || 'Agent',
            personality: state.personality || 'butler',
            honorific: state.honorific,
        };
        // Write the new profile files
        await saveUserProfile(user);
        await savePhaibelProfile(phaibel);
        debug('profiles', `Migrated .state.json → profiles/`);
        return { user, phaibel };
    }
    catch {
        return null;
    }
}
// ── Helpers ──────────────────────────────────────────────────────────────────
function buildUserProfileBody(profile) {
    const lines = [`# ${profile.name}`, ''];
    if (profile.homeLocation)
        lines.push(`Home: ${profile.homeLocation}`);
    if (profile.workLocation)
        lines.push(`Work: ${profile.workLocation}`);
    if (profile.employer)
        lines.push(`Employer: ${profile.employer}`);
    if (profile.workType)
        lines.push(`Role: ${profile.workType}`);
    if (profile.familySituation)
        lines.push(`Family: ${profile.familySituation}`);
    if (profile.currency)
        lines.push(`Currency: ${profile.currency}`);
    if (profile.language)
        lines.push(`Language: ${profile.language}`);
    if (profile.timezone)
        lines.push(`Timezone: ${profile.timezone}`);
    if (profile.beliefs)
        lines.push(`Beliefs: ${profile.beliefs}`);
    return lines.join('\n') + '\n';
}
function cleanMeta(obj) {
    const clean = {};
    for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined && value !== null) {
            clean[key] = value;
        }
    }
    return clean;
}
