// ─────────────────────────────────────────────────────────────────────────────
// A2A Agents — Configuration
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fsPromises } from 'fs';
import { getAgentsConfigPath, getVaultConfigDir } from '../paths.js';

export interface AgentEntry {
    id: string;
    name: string;
    url: string;               // Base URL of the A2A agent (e.g. "http://localhost:4000")
    description?: string;      // Human-readable description
    headers?: Record<string, string>;  // Optional auth/custom headers
}

export interface AgentsConfig {
    agents: AgentEntry[];
}

export async function loadAgentsConfig(): Promise<AgentsConfig> {
    try {
        const configPath = await getAgentsConfigPath();
        const raw = await fsPromises.readFile(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        return { agents: parsed.agents ?? [] };
    } catch {
        return { agents: [] };
    }
}

export async function saveAgentsConfig(cfg: AgentsConfig): Promise<void> {
    const dir = await getVaultConfigDir();
    await fsPromises.mkdir(dir, { recursive: true });
    const configPath = await getAgentsConfigPath();
    await fsPromises.writeFile(configPath, JSON.stringify(cfg, null, 2));
}
