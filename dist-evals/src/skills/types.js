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
export {};
