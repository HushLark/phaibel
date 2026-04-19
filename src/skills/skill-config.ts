// ─────────────────────────────────────────────────────────────────────────────
// MCP Skills — Configuration
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fsPromises } from 'fs';
import { getSkillsConfigPath, getVaultConfigDir } from '../paths.js';

export interface SkillEntry {
    id: string;
    name: string;
    command: string;
    args: string[];
    env: Record<string, string>;
}

export interface SkillsConfig {
    skills: SkillEntry[];
}

export async function loadSkillsConfig(): Promise<SkillsConfig> {
    try {
        const configPath = await getSkillsConfigPath();
        const raw = await fsPromises.readFile(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        return { skills: parsed.skills ?? [] };
    } catch {
        return { skills: [] };
    }
}

export async function saveSkillsConfig(cfg: SkillsConfig): Promise<void> {
    const dir = await getVaultConfigDir();
    await fsPromises.mkdir(dir, { recursive: true });
    const configPath = await getSkillsConfigPath();
    await fsPromises.writeFile(configPath, JSON.stringify(cfg, null, 2));
}
