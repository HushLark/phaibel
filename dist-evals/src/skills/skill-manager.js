// ─────────────────────────────────────────────────────────────────────────────
// SKILLS — Manager
// ─────────────────────────────────────────────────────────────────────────────
//
// Scans skill directories, parses SKILL.md frontmatter, loads full manifests
// and Feral CCF scripts on demand.
//
// Skill search path (in order):
//   1. {foundationDir}/skills/   — project-level skills
//   2. ~/.phaibel/skills/        — user-level skills
// ─────────────────────────────────────────────────────────────────────────────
import { promises as fs } from 'fs';
import matter from 'gray-matter';
import { getPlatform } from '../platform/index.js';
import { getSkillsDir, SYSTEM_DIR } from '../paths.js';
import { debug } from '../utils/debug.js';
// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
async function listSubdirectories(dir) {
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        return entries.filter(e => e.isDirectory()).map(e => e.name);
    }
    catch {
        return [];
    }
}
async function skillMetaFromDir(directory) {
    const { paths } = getPlatform();
    const skillMdPath = paths.join(directory, 'SKILL.md');
    try {
        const raw = await fs.readFile(skillMdPath, 'utf-8');
        const { data } = matter(raw);
        const fm = data;
        if (!fm.name || !fm.description)
            return null;
        // Discover script names
        const scriptsDir = paths.join(directory, 'scripts');
        let scriptNames = [];
        try {
            const files = await fs.readdir(scriptsDir);
            scriptNames = files
                .filter(f => f.endsWith('.json'))
                .map(f => f.replace(/\.json$/, ''));
        }
        catch { /* no scripts dir */ }
        return {
            name: fm.name,
            description: fm.description,
            tags: Array.isArray(fm.tags) ? fm.tags : [],
            triggers: Array.isArray(fm.triggers) ? fm.triggers : [],
            directory,
            scriptNames,
        };
    }
    catch (err) {
        debug('skills', `Failed to parse SKILL.md at ${directory}: ${err}`);
        return null;
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Load lightweight SkillMeta for all installed skills.
 * Searches project-level then user-level skill directories.
 */
export async function loadSkillMetas() {
    const { paths } = getPlatform();
    const metas = [];
    const seen = new Set();
    const searchRoots = [
        await getSkillsDir().catch(() => null),
        paths.join(SYSTEM_DIR(), 'skills'),
    ].filter(Boolean);
    for (const root of searchRoots) {
        const subdirs = await listSubdirectories(root);
        for (const subdir of subdirs) {
            if (seen.has(subdir))
                continue;
            const fullDir = paths.join(root, subdir);
            const meta = await skillMetaFromDir(fullDir);
            if (meta) {
                metas.push(meta);
                seen.add(subdir);
            }
        }
    }
    debug('skills', `Loaded ${metas.length} skill metas`);
    return metas;
}
/**
 * Load the full SkillManifest (SKILL.md body + frontmatter) for a skill by name.
 */
export async function loadSkillManifest(meta) {
    const { paths } = getPlatform();
    const skillMdPath = paths.join(meta.directory, 'SKILL.md');
    const raw = await fs.readFile(skillMdPath, 'utf-8');
    const { data, content } = matter(raw);
    return {
        ...meta,
        frontmatter: data,
        body: content.trim(),
    };
}
/**
 * Load a specific Feral CCF process script from a skill's scripts/ directory.
 * Returns null if the script file does not exist or fails to parse.
 */
export async function loadSkillScript(meta, scriptName) {
    const { paths } = getPlatform();
    const name = scriptName ?? meta.scriptNames[0];
    if (!name)
        return null;
    const filepath = paths.join(meta.directory, 'scripts', `${name}.json`);
    try {
        const raw = await fs.readFile(filepath, 'utf-8');
        const process = JSON.parse(raw);
        return { name, filepath, process };
    }
    catch (err) {
        debug('skills', `Failed to load script ${filepath}: ${err}`);
        return null;
    }
}
/**
 * Load all Feral CCF process scripts from a skill's scripts/ directory.
 */
export async function loadAllSkillScripts(meta) {
    const scripts = [];
    for (const name of meta.scriptNames) {
        const script = await loadSkillScript(meta, name);
        if (script)
            scripts.push(script);
    }
    return scripts;
}
/**
 * Create a new skill directory scaffolded with SKILL.md and an empty scripts/ dir.
 */
export async function createSkill(name, description) {
    const { paths } = getPlatform();
    const skillsDir = await getSkillsDir();
    const skillDir = paths.join(skillsDir, name);
    const scriptsDir = paths.join(skillDir, 'scripts');
    await fs.mkdir(scriptsDir, { recursive: true });
    const skillMd = [
        '---',
        `name: ${name}`,
        `description: "${description}"`,
        'version: "1.0.0"',
        'triggers: []',
        'tags: []',
        '---',
        '',
        `# ${name}`,
        '',
        description,
        '',
        '## Instructions',
        '',
        'Describe what this skill does and how to use it.',
    ].join('\n');
    await fs.writeFile(paths.join(skillDir, 'SKILL.md'), skillMd, 'utf-8');
    return skillDir;
}
