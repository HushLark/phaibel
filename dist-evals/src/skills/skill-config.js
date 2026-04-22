// ─────────────────────────────────────────────────────────────────────────────
// MCP Skills — Configuration
// ─────────────────────────────────────────────────────────────────────────────
import { promises as fsPromises } from 'fs';
import { getSkillsConfigPath, getVaultConfigDir } from '../paths.js';
export async function loadSkillsConfig() {
    try {
        const configPath = await getSkillsConfigPath();
        const raw = await fsPromises.readFile(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        return { skills: parsed.skills ?? [] };
    }
    catch {
        return { skills: [] };
    }
}
export async function saveSkillsConfig(cfg) {
    const dir = await getVaultConfigDir();
    await fsPromises.mkdir(dir, { recursive: true });
    const configPath = await getSkillsConfigPath();
    await fsPromises.writeFile(configPath, JSON.stringify(cfg, null, 2));
}
