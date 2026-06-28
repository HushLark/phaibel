// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Introspect Catalog Source
// ─────────────────────────────────────────────────────────────────────────────
//
// Pre-configured CatalogNodes for common introspection queries.
// Each node binds the `introspect` NodeCode with a specific target.
// ─────────────────────────────────────────────────────────────────────────────

import type { CatalogNode } from './catalog-node.js';

interface IntrospectEntry {
    key: string;
    name: string;
    description: string;
    target: string;
    contextPath: string;
    nodeCodeKey?: string;
}

const INTROSPECT_NODES: IntrospectEntry[] = [
    // ── Original entries ─────────────────────────────────────────────────
    {
        key: 'get_user_profile',
        name: 'Get User Profile',
        description: 'Loads the user profile (name, gender, work type, etc.) into context.',
        target: 'user_profile',
        contextPath: 'user_profile',
    },
    {
        key: 'get_agent_profile',
        name: 'Get Agent Profile',
        description: 'Loads the Phaibel agent profile (name, personality preset) into context.',
        target: 'agent',
        contextPath: 'agent_profile',
    },
    {
        key: 'get_configured_providers',
        name: 'Get Configured Providers',
        description: 'Lists which AI providers have API keys configured (names only, no keys).',
        target: 'providers',
        contextPath: 'configured_providers',
    },
    {
        key: 'get_capability_config',
        name: 'Get Capability Config',
        description: 'Shows the effective provider+model mapping for each LLM capability.',
        target: 'capabilities',
        contextPath: 'capability_config',
    },
    {
        key: 'get_service_status',
        name: 'Get Service Status',
        description: 'Checks whether the Phaibel daemon is running and its PID.',
        target: 'service',
        contextPath: 'service_status',
    },
    {
        key: 'get_vault_info',
        name: 'Get Vault Info',
        description: 'Returns the vault root path, active project, and list of all projects.',
        target: 'vault',
        contextPath: 'vault_info',
    },
    {
        key: 'get_cron_schedule',
        name: 'Get Cron Schedule',
        description: 'Shows all cron jobs with their enabled/disabled status and interval in minutes.',
        target: 'cron_schedule',
        contextPath: 'cron_schedule',
    },
    {
        key: 'list_processes',
        name: 'List Processes',
        description: 'Lists all available reusable processes with their keys and descriptions.',
        target: '',
        contextPath: 'processes',
        nodeCodeKey: 'list_processes',
    },
    {
        key: 'list_catalog_nodes',
        name: 'List Catalog Nodes',
        description: 'Lists all available catalog nodes (capabilities) grouped by category.',
        target: '',
        contextPath: 'catalog_nodes',
        nodeCodeKey: 'list_catalog_nodes',
    },
    // ── New v5.1 entries ─────────────────────────────────────────────────
    {
        key: 'get_personality',
        name: 'Get Personality',
        description: 'Loads the active personality preset (label, description, system prompt block, honorifics).',
        target: 'personality',
        contextPath: 'personality',
    },
    {
        key: 'get_settings',
        name: 'Get Settings',
        description: 'Shows capability mapping overrides and default provider (no secrets).',
        target: 'settings',
        contextPath: 'settings',
    },
    {
        key: 'get_entity_types',
        name: 'Get Entity Types',
        description: 'Lists all configured entity types with their fields and directories.',
        target: 'entity_types',
        contextPath: 'entity_types',
    },
    {
        key: 'get_entity_stats',
        name: 'Get Entity Stats',
        description: 'Returns entity counts per type and total entities in the vault.',
        target: 'entity_stats',
        contextPath: 'entity_stats',
    },
    {
        key: 'get_queue_status',
        name: 'Get Queue Status',
        description: 'Shows queue size, pending/processing counts, completed count, and error count.',
        target: 'queue',
        contextPath: 'queue_status',
    },
    {
        key: 'get_token_usage',
        name: 'Get Token Usage',
        description: 'Returns LLM token usage per model over the last 30 days.',
        target: 'token_usage',
        contextPath: 'token_usage',
    },
    {
        key: 'get_a2a_agents',
        name: 'Get A2A Agents',
        description: 'Lists all discovered A2A agents with their skills.',
        target: 'a2a_agents',
        contextPath: 'a2a_agents',
    },
    {
        key: 'get_recent_chats',
        name: 'Get Recent Chats',
        description: 'Returns summaries of the 20 most recent chat sessions (ID, timestamp, first user message).',
        target: 'recent_chats',
        contextPath: 'recent_chats',
    },
    {
        key: 'get_calendars',
        name: 'Get Connected Calendars',
        description: 'Lists connected calendar feeds (name, host, sync window) — answers "what calendars am I connected to?".',
        target: 'calendars',
        contextPath: 'calendars',
    },
    {
        key: 'get_cfx3_connections',
        name: 'Get CF/x3 Connections',
        description: 'Lists connected CF/x3 federated-context sources (name, URL, context types, last sync) — answers "what sources / connections do I have?".',
        target: 'cfx3_connections',
        contextPath: 'cfx3_connections',
    },
];

export class IntrospectCatalogSource {
    getCatalogNodes(): CatalogNode[] {
        return INTROSPECT_NODES.map(entry => ({
            key: entry.key,
            nodeCodeKey: entry.nodeCodeKey ?? 'introspect',
            name: entry.name,
            group: 'introspection',
            description: entry.description,
            configuration: {
                ...(entry.target ? { target: entry.target } : {}),
                context_path: entry.contextPath,
            },
        }));
    }
}
