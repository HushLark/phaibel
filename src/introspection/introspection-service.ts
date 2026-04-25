// ─────────────────────────────────────────────────────────────────────────────
// Phaibel Introspection — Service
// ─────────────────────────────────────────────────────────────────────────────
// Standalone, read-only gateway to all Phaibel system state (excluding secrets).
// Both the REST router and Feral CCF node codes delegate to this service.
// ─────────────────────────────────────────────────────────────────────────────

import { getPlatform } from '../platform/index.js';
import { loadUserProfile, loadPhaibelProfile } from '../profiles/profile-manager.js';
import { getConfiguredProviders, getEffectiveConfig, loadConfig } from '../config.js';
import { getDaemonStatus } from '../service/daemon.js';
import { findFoundationRoot } from '../state/manager.js';
import { loadCronConfig } from '../service/cron/scheduler.js';
import { loadEntityTypes } from '../entities/entity-type-config.js';
import { listEntities } from '../entities/entity.js';
import { getPersonality } from '../personalities.js';
import { loadProfile as loadBigFiveProfile } from '../personality/big-five.js';
import { getAllUsage } from '../llm/token-usage.js';
import { getLogsDir } from '../paths.js';
import { debug } from '../utils/debug.js';
import { bootstrapFeral, type FeralRuntime } from '../feral/bootstrap.js';

import type {
    HealthInfo,
    PersonalityInfo,
    SettingsInfo,
    FoundationInfo,
    ServiceInfo,
    CronInfo,
    CatalogInfo,
    ProcessesInfo,
    EntityTypeInfo,
    EntityStatsInfo,
    RecentChatSummary,
} from './introspection-types.js';

import type { UserProfile, PhaibelProfile } from '../profiles/profile-types.js';
import type { BigFiveProfile } from '../personality/big-five.js';
import type { UsageSummary } from '../llm/token-usage.js';
import type { QueueStatus } from '../service/protocol.js';

// ── Lazy Feral Runtime ───────────────────────────────────────────────────────

let _feral: FeralRuntime | null = null;

async function getFeral(): Promise<FeralRuntime> {
    if (!_feral) {
        _feral = await bootstrapFeral();
    }
    return _feral;
}

// ── Service ──────────────────────────────────────────────────────────────────

export class IntrospectionService {

    // ── Health ───────────────────────────────────────────────────────────

    async getHealth(): Promise<HealthInfo> {
        const root = await findFoundationRoot();
        const daemonStatus = await getDaemonStatus();
        const providers = await getConfiguredProviders();

        return {
            status: root && providers.length > 0 ? 'ok' : 'degraded',
            foundation: root ? true : false,
            service: daemonStatus.running,
            providers: providers.length,
        };
    }

    // ── Profiles ─────────────────────────────────────────────────────────

    async getProfile(): Promise<UserProfile> {
        return loadUserProfile();
    }

    async getAgent(): Promise<PhaibelProfile> {
        return loadPhaibelProfile();
    }

    async getPersonality(): Promise<PersonalityInfo> {
        const profile = await loadPhaibelProfile();
        const personality = getPersonality(profile.personality);
        return {
            id: personality.id,
            label: personality.label,
            description: personality.description,
            systemPromptBlock: personality.systemPromptBlock,
            honorifics: personality.honorifics,
        };
    }

    async getBigFive(): Promise<BigFiveProfile | null> {
        return loadBigFiveProfile();
    }

    // ── Configuration ────────────────────────────────────────────────────

    async getProviders(): Promise<{ providers: string[] }> {
        const providers = await getConfiguredProviders();
        return { providers };
    }

    async getCapabilities(): Promise<Record<string, unknown>> {
        return await getEffectiveConfig();
    }

    async getSettings(): Promise<SettingsInfo> {
        const config = await loadConfig();
        return {
            capabilityMapping: config.capabilityMapping,
            defaultProvider: config.defaultProvider,
        };
    }

    // ── Service Status ───────────────────────────────────────────────────

    async getService(): Promise<ServiceInfo> {
        const status = await getDaemonStatus();
        return {
            running: status.running,
            pid: status.pid,
            uptime: Math.round(process.uptime()),
            memory: {
                rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
                heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            },
        };
    }

    // ── Foundation / Vault ───────────────────────────────────────────────

    async getFoundation(): Promise<FoundationInfo> {
        const root = await findFoundationRoot();
        if (!root) {
            return { root: null, contextTypes: 0, typeNames: [], totalNodes: 0 };
        }

        const types = await loadEntityTypes();
        let totalNodes = 0;
        for (const t of types) {
            try {
                const entities = await listEntities(t.name, { metaOnly: true });
                totalNodes += entities.length;
            } catch {
                // Type directory may not exist
            }
        }

        return {
            root,
            contextTypes: types.length,
            typeNames: types.map(t => t.name),
            totalNodes,
        };
    }

    async getEntityTypes(): Promise<EntityTypeInfo[]> {
        const types = await loadEntityTypes();
        return types.map(t => ({
            name: t.name,
            plural: t.plural,
            directory: t.directory,
            fields: t.fields ?? [],
        }));
    }

    async getEntityStats(): Promise<EntityStatsInfo> {
        const types = await loadEntityTypes();
        const stats: Array<{ name: string; count: number }> = [];
        let totalEntities = 0;

        for (const t of types) {
            try {
                const entities = await listEntities(t.name, { metaOnly: true });
                stats.push({ name: t.name, count: entities.length });
                totalEntities += entities.length;
            } catch {
                stats.push({ name: t.name, count: 0 });
            }
        }

        return { types: stats, totalEntities };
    }

    // ── Cron ─────────────────────────────────────────────────────────────

    async getCron(): Promise<CronInfo> {
        const config = await loadCronConfig();
        return { jobs: config.jobs };
    }

    // ── Queue ────────────────────────────────────────────────────────────

    async getQueue(): Promise<QueueStatus> {
        try {
            const { getQueueManager } = await import('../service/queue/manager.js');
            const qm = await getQueueManager();
            return qm.getFullStatus();
        } catch {
            return { size: 0, maxSize: 10, isFull: false, processing: 0, pending: 0, completedCount: 0, errorCount: 0 };
        }
    }

    // ── Token Usage ──────────────────────────────────────────────────────

    async getTokenUsage(days = 30): Promise<UsageSummary[]> {
        return getAllUsage(days);
    }

    // ── Feral CCF ────────────────────────────────────────────────────────

    async getCatalog(): Promise<CatalogInfo> {
        const feral = await getFeral();
        const nodes = feral.catalog.getAllCatalogNodes();

        const grouped: Record<string, Array<{ key: string; name: string; description: string }>> = {};
        for (const node of nodes) {
            const group = node.group || 'ungrouped';
            if (!grouped[group]) grouped[group] = [];
            grouped[group].push({
                key: node.key,
                name: node.name,
                description: node.description,
            });
        }

        return { totalNodes: nodes.length, groups: grouped };
    }

    async getProcesses(): Promise<ProcessesInfo> {
        const feral = await getFeral();
        const processes = feral.processFactory.getAllProcesses();

        return {
            count: processes.length,
            processes: processes.map(p => ({
                key: p.key,
                description: p.description,
            })),
        };
    }

    // ── A2A Agents ───────────────────────────────────────────────────────

    async getA2aAgents(): Promise<Array<{ agentId: string; agentName: string; description: string; url: string }>> {
        try {
            const { a2aClient } = await import('../agents/a2a-client.js');
            const agents = await a2aClient.discoverAllAgents();
            return agents.map(a => ({
                agentId: a.agentId,
                agentName: a.agentName,
                description: a.description,
                url: a.url,
            }));
        } catch {
            return [];
        }
    }

    // ── Recent Chats ─────────────────────────────────────────────────────

    async getRecentChats(limit = 20): Promise<RecentChatSummary[]> {
        try {
            const { storage, paths } = getPlatform();
            const logsDir = await getLogsDir();
            const files = await storage.readdir(logsDir);
            const logFiles = files.filter(f => f.endsWith('.log')).sort().reverse();

            const results: RecentChatSummary[] = [];
            for (const file of logFiles.slice(0, limit)) {
                const chatId = file.replace('.log', '');
                try {
                    const content = await storage.readFile(paths.join(logsDir, file));
                    const firstLine = content.split('\n')[0];
                    if (!firstLine) continue;
                    const entry = JSON.parse(firstLine);
                    results.push({
                        chatId,
                        startedAt: entry.ts ?? '',
                        userMessage: entry.data?.userMessage ?? entry.data?.input ?? null,
                    });
                } catch {
                    results.push({ chatId, startedAt: '', userMessage: null });
                }
            }

            return results;
        } catch (error) {
            debug('introspection', `getRecentChats failed: ${error}`);
            return [];
        }
    }
}
