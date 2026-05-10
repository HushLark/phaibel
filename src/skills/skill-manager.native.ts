// React Native stub — fs is not available on mobile; all skill operations return empty/null.
import type { SkillMeta, SkillManifest, SkillScript } from './types.js';

export async function loadSkillMetas(): Promise<SkillMeta[]> { return []; }

export async function loadSkillManifest(_meta: SkillMeta): Promise<SkillManifest> {
    throw new Error('Skills not supported on mobile');
}

export async function loadSkillScript(_meta: SkillMeta, _scriptName?: string): Promise<SkillScript | null> {
    return null;
}

export async function loadAllSkillScripts(_meta: SkillMeta): Promise<SkillScript[]> { return []; }

export async function createSkill(_name: string, _description: string): Promise<string> {
    throw new Error('Skills not supported on mobile');
}
