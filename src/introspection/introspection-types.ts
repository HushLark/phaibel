// ─────────────────────────────────────────────────────────────────────────────
// Phaibel Introspection — Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

// Re-export types from other modules that are returned as-is
export type { UserProfile, PhaibelProfile } from '../profiles/profile-types.js';
export type { UsageSummary } from '../llm/token-usage.js';
export type { A2ADiscoveredAgent } from '../agents/a2a-client.js';
export type { QueueStatus } from '../service/protocol.js';

// ── New types ────────────────────────────────────────────────────────────────

export interface HealthInfo {
    status: 'ok' | 'degraded';
    foundation: boolean;
    service: boolean;
    providers: number;
}

export interface PersonalityInfo {
    id: string;
    label: string;
    description: string;
    systemPromptBlock: string;
    honorifics: Record<string, string[]>;
}

export interface SettingsInfo {
    capabilityMapping: Record<string, unknown>;
    defaultProvider: string;
}

export interface FoundationInfo {
    root: string | null;
    contextTypes: number;
    typeNames: string[];
    totalNodes: number;
}

export interface ServiceInfo {
    running: boolean;
    pid: number | null;
    uptime: number;
    memory: {
        rss: number;
        heapUsed: number;
    };
}

export interface CronInfo {
    jobs: Record<string, unknown>;
}

export interface CatalogInfo {
    totalNodes: number;
    groups: Record<string, Array<{ key: string; name: string; description: string }>>;
}

export interface ProcessesInfo {
    count: number;
    processes: Array<{ key: string; description: string }>;
}

export interface EntityTypeInfo {
    name: string;
    plural: string;
    directory: string;
    fields: unknown[];
}

export interface EntityStatsInfo {
    types: Array<{ name: string; count: number }>;
    totalEntities: number;
}

export interface RecentChatSummary {
    chatId: string;
    startedAt: string;
    userMessage: string | null;
}
