// ─────────────────────────────────────────────────────────────────────────────
// Feral A2A — Catalog Source
// ─────────────────────────────────────────────────────────────────────────────
import { createCatalogNode } from './catalog-node.js';
/**
 * Provides CatalogNodes for skills discovered from A2A agents.
 * Each agent skill becomes a selectable catalog node.
 * Agents with no declared skills get a single "chat" node.
 */
export class A2ACatalogSource {
    agents;
    constructor(agents) {
        this.agents = agents;
    }
    getCatalogNodes() {
        const nodes = [];
        for (const agent of this.agents) {
            if (agent.skills.length > 0) {
                // One catalog node per declared skill
                for (const skill of agent.skills) {
                    nodes.push(createCatalogNode({
                        key: `a2a_${agent.agentId}_${skill.id}`,
                        nodeCodeKey: 'a2a_send_task',
                        name: `${agent.agentName}: ${skill.name}`,
                        group: `agent:${agent.agentId}`,
                        description: skill.description,
                        configuration: {
                            agent_id: agent.agentId,
                            agent_name: agent.agentName,
                            skill_id: skill.id,
                        },
                    }));
                }
            }
            else {
                // Agent without declared skills — single chat node
                nodes.push(createCatalogNode({
                    key: `a2a_${agent.agentId}_chat`,
                    nodeCodeKey: 'a2a_send_task',
                    name: `${agent.agentName}: Chat`,
                    group: `agent:${agent.agentId}`,
                    description: agent.description,
                    configuration: {
                        agent_id: agent.agentId,
                        agent_name: agent.agentName,
                    },
                }));
            }
        }
        return nodes;
    }
}
