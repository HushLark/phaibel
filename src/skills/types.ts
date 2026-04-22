// ─────────────────────────────────────────────────────────────────────────────
// SKILLS — Types (agentskills.io-compatible)
// ─────────────────────────────────────────────────────────────────────────────
//
// Skills are directories containing a SKILL.md file (frontmatter + body) and
// an optional scripts/ directory of Feral CCF process JSON files.
//
// Lifecycle:
//   SkillMeta   — frontmatter only; loaded at startup (~100 tokens each)
//   SkillManifest — full SKILL.md + script names; loaded on activation
//   SkillScript — the Feral process JSON; loaded for execution
// ─────────────────────────────────────────────────────────────────────────────

/** SKILL.md YAML frontmatter fields (agentskills.io spec + Phaibel extensions). */
export interface SkillFrontmatter {
    name: string;
    description: string;
    version?: string;
    license?: string;
    compatibility?: string;
    metadata?: Record<string, unknown>;
    'allowed-tools'?: string;
    /** Keyword phrases that suggest this skill should match. */
    triggers?: string[];
    /** Taxonomy tags. */
    tags?: string[];
}

/** Lightweight skill descriptor — loaded at startup for all skills. */
export interface SkillMeta {
    name: string;
    description: string;
    tags: string[];
    triggers: string[];
    directory: string;
    scriptNames: string[];   // basenames (no extension) of scripts/ *.json files
}

/** Full skill descriptor — loaded when the skill is activated. */
export interface SkillManifest extends SkillMeta {
    frontmatter: SkillFrontmatter;
    /** Full SKILL.md markdown body (instructions). */
    body: string;
}

/** A loaded Feral CCF process from a skill's scripts/ directory. */
export interface SkillScript {
    name: string;                          // basename without .json
    filepath: string;
    process: Record<string, unknown>;      // raw Feral process JSON
}
