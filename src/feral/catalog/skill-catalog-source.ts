// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Skill Catalog Source
// ─────────────────────────────────────────────────────────────────────────────
//
// Generates CatalogNodes from installed skills so the LLM can include skill
// execution steps when building Feral processes.
//
// Self-refreshing: getCatalogNodes() returns from an in-memory cache and
// fires a background reload whenever the cache is older than TTL_MS (60s).
// Call invalidate() after adding or removing a skill to force an immediate
// refresh on the next getCatalogNodes() call — no service restart needed.
//
// Node generation rules:
//   - Skill with one script (or no scripts): one node
//       key:  run_skill_{name}
//   - Skill with multiple scripts: one node per script variant
//       key:  run_skill_{name}_{scriptname}
//
// All nodes use the 'run_skill' NodeCode with pre-configured skill_name
// (and script_name where needed), and carry group: 'skill'.
// ─────────────────────────────────────────────────────────────────────────────

import type { CatalogSource } from './catalog.js';
import type { CatalogNode } from './catalog-node.js';
import { createCatalogNode } from './catalog-node.js';
import type { SkillMeta } from '../../skills/types.js';
import { loadSkillMetas } from '../../skills/skill-manager.js';

/** Cache TTL: refresh nodes in the background after this many ms. */
const TTL_MS = 60_000;

/** Normalise a skill/script name to a safe catalog key segment. */
function toKey(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function buildNodes(metas: SkillMeta[]): CatalogNode[] {
    const nodes: CatalogNode[] = [];
    for (const skill of metas) {
        const nameKey = toKey(skill.name);
        if (skill.scriptNames.length <= 1) {
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

export class SkillCatalogSource implements CatalogSource {
    private _nodes: CatalogNode[] = [];
    private _loadedAt = 0;
    private _inflight: Promise<void> | null = null;

    /**
     * Pre-warm the cache synchronously before the catalog is first used.
     * Called by bootstrap so the first getCatalogNodes() call isn't empty.
     */
    async preload(): Promise<void> {
        await this._load();
    }

    /**
     * Mark the cache stale so the next getCatalogNodes() triggers a reload.
     * Call this after createSkill() / deleteSkill() for immediate propagation.
     */
    invalidate(): void {
        this._loadedAt = 0;
    }

    /**
     * Returns current cached catalog nodes.
     * If the cache is older than TTL_MS, fires a background refresh —
     * the current request gets the existing nodes; the next request gets fresh ones.
     */
    getCatalogNodes(): CatalogNode[] {
        if (Date.now() - this._loadedAt > TTL_MS) {
            this._load().catch(() => {});
        }
        return this._nodes;
    }

    private async _load(): Promise<void> {
        // Deduplicate concurrent loads
        if (this._inflight) return this._inflight;
        this._inflight = (async () => {
            const metas = await loadSkillMetas().catch(() => [] as SkillMeta[]);
            this._nodes = buildNodes(metas);
            this._loadedAt = Date.now();
            this._inflight = null;
        })();
        return this._inflight;
    }
}
