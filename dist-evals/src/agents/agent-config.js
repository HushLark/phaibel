// ─────────────────────────────────────────────────────────────────────────────
// A2A Agents — Configuration
// ─────────────────────────────────────────────────────────────────────────────
import { promises as fsPromises } from 'fs';
import { getAgentsConfigPath, getVaultConfigDir } from '../paths.js';
export async function loadAgentsConfig() {
    try {
        const configPath = await getAgentsConfigPath();
        const raw = await fsPromises.readFile(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        return { agents: parsed.agents ?? [] };
    }
    catch {
        return { agents: [] };
    }
}
export async function saveAgentsConfig(cfg) {
    const dir = await getVaultConfigDir();
    await fsPromises.mkdir(dir, { recursive: true });
    const configPath = await getAgentsConfigPath();
    await fsPromises.writeFile(configPath, JSON.stringify(cfg, null, 2));
}
