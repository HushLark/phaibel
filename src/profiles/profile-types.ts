// ─────────────────────────────────────────────────────────────────────────────
// Profile Types — User and Phaibel agent profile definitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * User profile stored at (Foundation)/profiles/user-profile.md
 * Contains personal information used to personalize Phaibel's behavior.
 */
export interface UserProfile {
    name: string;
    gender?: 'male' | 'female' | 'other';
    /** Home city/region */
    homeLocation?: string;
    /** Work city/region */
    workLocation?: string;
    /** Birth location */
    birthLocation?: string;
    /** Current location (transient) */
    currentLocation?: string;
    /** Preferred currency (e.g. "USD", "EUR") */
    currency?: string;
    /** Primary language (e.g. "en", "es") */
    language?: string;
    /** Timezone (e.g. "America/Denver") */
    timezone?: string;
    /** Beliefs, values, cultural notes */
    beliefs?: string;
    /** Employer or company */
    employer?: string;
    /** Job type/role */
    workType?: string;
    /** Family situation description */
    familySituation?: string;
    /** Has personal vehicle */
    hasCar?: boolean;
    /** Personal calendar URL */
    personalCalUrl?: string;
    /** Work calendar URL */
    workCalUrl?: string;
    /** Whether onboarding interview is complete */
    interviewComplete?: boolean;
    /** Last used date (ISO 8601) */
    lastUsed?: string;
}

/**
 * Phaibel agent profile stored at (Foundation)/profiles/phaibel-profile.md
 * Defines the agent's personality and guardrails.
 */
export interface PhaibelProfile {
    /** Agent display name */
    name: string;
    /** Personality preset */
    personality: 'butler' | 'rockstar' | 'executive' | 'friend';
    /** Honorific used to address the user */
    honorific?: string;
    /** Agent version */
    version?: string;
}
