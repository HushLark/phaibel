// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Introspect NodeCode
// ─────────────────────────────────────────────────────────────────────────────
//
// Lets Feral processes query the agent's own configuration without leaking secrets.
// The `target` config param selects which slice of settings to load.
// All data is fetched through the IntrospectionService.
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { IntrospectionService } from '../../../introspection/introspection-service.js';
const VALID_TARGETS = [
    'user_profile', 'agent', 'personality', 'big_five',
    'providers', 'capabilities', 'settings',
    'service', 'vault', 'cron_schedule',
    'entity_types', 'entity_stats',
    'queue', 'token_usage',
    'mcp_skills', 'a2a_agents', 'recent_chats',
];
const service = new IntrospectionService();
export class IntrospectNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        {
            key: 'target',
            name: 'Target',
            description: `What to introspect: ${VALID_TARGETS.join(', ')}`,
            type: 'string',
        },
        {
            key: 'context_path',
            name: 'Context Path',
            description: 'Context key to store the result.',
            type: 'string',
            default: 'introspection',
            isOptional: true,
        },
    ];
    static resultDescriptions = [
        { status: ResultStatus.OK, description: 'Introspection data loaded.' },
        { status: ResultStatus.ERROR, description: 'Failed to load introspection data.' },
    ];
    constructor() {
        super('introspect', 'Introspect', 'Queries the agent\'s own configuration — user profile, agent profile, personality, providers, capabilities, settings, service status, vault info, entity types/stats, queue, token usage, MCP skills, A2A agents, or recent chats.', NodeCodeCategory.DATA);
    }
    async process(context) {
        const target = this.getRequiredConfigValue('target');
        const contextPath = this.getOptionalConfigValue('context_path', 'introspection');
        if (!VALID_TARGETS.includes(target)) {
            return this.result(ResultStatus.ERROR, `Unknown introspect target: "${target}". Valid: ${VALID_TARGETS.join(', ')}`);
        }
        try {
            const data = await this.loadTarget(target);
            context.set(contextPath, data);
            return this.result(ResultStatus.OK, `${contextPath} loaded (target: ${target})`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.result(ResultStatus.ERROR, `Introspect failed for "${target}": ${message}`);
        }
    }
    async loadTarget(target) {
        switch (target) {
            case 'user_profile': return service.getProfile();
            case 'agent': return service.getAgent();
            case 'personality': return service.getPersonality();
            case 'big_five': return service.getBigFive();
            case 'providers': return service.getProviders();
            case 'capabilities': return service.getCapabilities();
            case 'settings': return service.getSettings();
            case 'service': return service.getService();
            case 'vault': return service.getFoundation();
            case 'cron_schedule': return service.getCron();
            case 'entity_types': return service.getEntityTypes();
            case 'entity_stats': return service.getEntityStats();
            case 'queue': return service.getQueue();
            case 'token_usage': return service.getTokenUsage();
            case 'mcp_skills': return service.getMcpSkills();
            case 'a2a_agents': return service.getA2aAgents();
            case 'recent_chats': return service.getRecentChats();
        }
    }
}
