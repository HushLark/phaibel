// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Skill Catalog Source
// ─────────────────────────────────────────────────────────────────────────────
//
// Generates CatalogNodes from installed skills so the LLM can include skill
// execution steps when building Feral processes.
//
// Node generation rules:
//   - One node per skill when the skill has a single script or no scripts:
//       key:  run_skill_{name}
//   - One node per script when a skill has multiple scripts:
//       key:  run_skill_{name}_{scriptname}
//
// All nodes use the 'run_skill' NodeCode, pre-configured with skill_name
// (and script_name where needed).
// ─────────────────────────────────────────────────────────────────────────────

import type { CatalogSource } from './catalog.js';
import type { CatalogNode } from './catalog-node.js';
import { createCatalogNode } from './catalog-node.js';
import type { SkillMeta } from '../../skills/types.js';

/** Normalise a skill/script name to a safe catalog key segment. */
function toKey(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export class SkillCatalogSource implements CatalogSource {
    constructor(private readonly skills: SkillMeta[]) {}

    getCatalogNodes(): CatalogNode[] {
        const nodes: CatalogNode[] = [];

        for (const skill of this.skills) {
            const nameKey = toKey(skill.name);

            if (skill.scriptNames.length <= 1) {
                // Single-script or script-less skill → one catalog node
                const scriptName = skill.scriptNames[0];
                nodes.push(createCatalogNode({
                    key: `run_skill_${nameKey}`,
                    nodeCodeKey: 'run_skill',
                    name: `Run skill: ${skill.name}`,
                    group: 'skill',
                    description: skill.description,
                    configuration: {
                        skill_name: skill.name,
                        ...(scriptName ? { script_name: scriptName } : {}),
                    },
                }));
            } else {
                // Multi-script skill → one catalog node per script variant
                for (const scriptName of skill.scriptNames) {
                    const scriptKey = toKey(scriptName);
                    nodes.push(createCatalogNode({
                        key: `run_skill_${nameKey}_${scriptKey}`,
                        nodeCodeKey: 'run_skill',
                        name: `Run skill: ${skill.name} / ${scriptName}`,
                        group: 'skill',
                        description: `${skill.description} [script: ${scriptName}]`,
                        configuration: {
                            skill_name: skill.name,
                            script_name: scriptName,
                        },
                    }));
                }
            }
        }

        return nodes;
    }
}
