// ─────────────────────────────────────────────────────────────────────────────
// CAPABILITY DISCOVERY
// ─────────────────────────────────────────────────────────────────────────────
//
// Two-tier capability retrieval that mirrors Progressive Disclosure but for
// skills and Feral CCF catalog nodes instead of vault entities.
//
// Tier 1 — lightweight summary sent upfront:
//   - Skill metas: name, description, triggers, script names
//   - Catalog node groups: key + description for each node
//
// Tier 2 — fetched on demand per LLM decision:
//   - Skill detail: full SKILL.md body + script node outline
//   - Node detail: configDescriptions + resultDescriptions
//
// The LLM iterates (up to MAX_ITERATIONS rounds) deciding what it needs, then
// returns one of:
//   selectedSkill  — run this skill's Feral process directly
//   hasEnoughContext:true — proceed to custom process composition
//
// The returned `contextSnapshot` is injected into Step 1 and Step 2 of the
// custom process pipeline so the LLM generates better-configured processes.
// ─────────────────────────────────────────────────────────────────────────────
import { debug } from '../utils/debug.js';
import { loadSkillManifest, loadSkillScript } from '../skills/skill-manager.js';
const MAX_ITERATIONS = 3;
// ─────────────────────────────────────────────────────────────────────────────
// TIER 1 FORMATTERS
// ─────────────────────────────────────────────────────────────────────────────
function formatSkillMetas(metas) {
    if (metas.length === 0)
        return '(no skills installed)';
    return metas.map(m => {
        const triggers = m.triggers.length ? ` [triggers: ${m.triggers.join(', ')}]` : '';
        const scripts = m.scriptNames.length ? ` [scripts: ${m.scriptNames.join(', ')}]` : ' [no scripts — instructions-only]';
        return `  ${m.name}: ${m.description}${triggers}${scripts}`;
    }).join('\n');
}
function formatCatalogSummary(catalog) {
    const nodes = catalog.getAllCatalogNodes().filter(n => !n.key.startsWith('speak_'));
    const byGroup = new Map();
    for (const n of nodes) {
        if (!byGroup.has(n.group))
            byGroup.set(n.group, []);
        byGroup.get(n.group).push(n);
    }
    return Array.from(byGroup.entries())
        .map(([group, ns]) => `  [${group}]\n${ns.map(n => `    ${n.key}: ${n.description || n.name}`).join('\n')}`)
        .join('\n');
}
// ─────────────────────────────────────────────────────────────────────────────
// TIER 2 FORMATTERS
// ─────────────────────────────────────────────────────────────────────────────
async function fetchSkillDetail(meta, scriptName) {
    const manifest = await loadSkillManifest(meta);
    const parts = [
        `--- SKILL: ${meta.name} ---`,
        manifest.body,
    ];
    const sName = scriptName ?? meta.scriptNames[0];
    if (sName) {
        const script = await loadSkillScript(meta, sName);
        if (script) {
            // Build a readable node chain from the process JSON
            const nodes = (script.process.nodes ?? []);
            const nodeLines = nodes.map(n => {
                const targets = Object.values(n.edges ?? {}).filter((v, i, a) => a.indexOf(v) === i);
                return `    ${n.key} (${n.catalog_node_key})${targets.length ? ' → ' + targets.join(', ') : ''}`;
            });
            parts.push(`Script "${sName}" nodes:\n${nodeLines.join('\n')}`);
        }
    }
    return parts.join('\n\n');
}
function fetchNodeDetail(nodeKey, catalog, nodeCodeFactory) {
    let catalogNode;
    try {
        catalogNode = catalog.getCatalogNode(nodeKey);
    }
    catch {
        return `  (node "${nodeKey}" not found in catalog)`;
    }
    let nodeCode;
    try {
        nodeCode = nodeCodeFactory.getNodeCode(catalogNode.nodeCodeKey);
    }
    catch {
        return `  ${nodeKey}: (no config docs available)`;
    }
    const Ctor = nodeCode.constructor;
    const configs = (Ctor.configDescriptions ?? []).filter(c => !c.isSecret);
    const results = Ctor.resultDescriptions ?? [];
    const lines = [`--- NODE: ${nodeKey} (${catalogNode.nodeCodeKey}) ---`];
    if (configs.length > 0) {
        lines.push('  Config:');
        for (const c of configs) {
            const opt = c.isOptional ? ', optional' : '';
            const def = c.default != null ? `, default: ${JSON.stringify(c.default)}` : '';
            lines.push(`    ${c.key} (${c.type}${opt}${def}): ${c.description}`);
        }
    }
    if (results.length > 0) {
        lines.push('  Results (edge keys):');
        for (const r of results) {
            lines.push(`    → "${r.status}": ${r.description}`);
        }
    }
    return lines.join('\n');
}
// ─────────────────────────────────────────────────────────────────────────────
// MAIN LOOP
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Run the Capability Discovery phase.
 *
 * The LLM iteratively browses skill manifests and catalog node docs until it
 * either selects a skill to run directly or declares it has enough context to
 * compose a custom Feral process.
 */
export async function runCapabilityDiscovery(llm, userInput, entityContext, skillMetas, catalog, nodeCodeFactory) {
    const skillTier1 = formatSkillMetas(skillMetas);
    const catalogTier1 = formatCatalogSummary(catalog);
    const collectedSkillDetails = [];
    const collectedNodeDetails = [];
    const fetchedSkills = new Set();
    const fetchedNodes = new Set();
    let capabilitySummary = '';
    // If no skills are installed, limit to one pass (node doc lookup only, no skill browsing)
    const effectiveMaxIterations = skillMetas.length === 0 ? 1 : MAX_ITERATIONS;
    for (let iteration = 0; iteration < effectiveMaxIterations; iteration++) {
        const skillDetailBlock = collectedSkillDetails.length > 0
            ? `\nSKILL DETAILS (loaded so far):\n${collectedSkillDetails.join('\n\n')}\n`
            : '';
        const nodeDetailBlock = collectedNodeDetails.length > 0
            ? `\nNODE DETAILS (loaded so far):\n${collectedNodeDetails.join('\n\n')}\n`
            : '';
        const prompt = `You are building a plan to handle a user request using the Phaibel Feral CCF system.

USER REQUEST: "${userInput}"

ENTITY CONTEXT (from vault):
${entityContext || '(none)'}

INSTALLED SKILLS (${skillMetas.length}):
${skillTier1}

AVAILABLE CATALOG NODES:
${catalogTier1}
${skillDetailBlock}${nodeDetailBlock}
${capabilitySummary ? `CAPABILITY SUMMARY SO FAR: ${capabilitySummary}\n` : ''}
You can:
- Load a skill's full instructions and script structure (to decide if it fits)
- Load a catalog node's config/result docs (to know how to use it in a process)
- Select a skill to run directly (if it clearly handles the request end-to-end)
- Declare hasEnoughContext:true when ready to compose a custom Feral process

Return JSON only:
{
  "needsSkillDetail": ["skill-name"],
  "needsNodeDetail": ["node_key1", "node_key2"],
  "selectedSkill": null,
  "selectedScript": null,
  "hasEnoughContext": false,
  "capabilitySummary": "brief note on what you've determined"
}`;
        let decision;
        try {
            const raw = await llm.chat([{ role: 'user', content: prompt }], { systemPrompt: 'You are a capability planner for Phaibel. Respond with JSON only.', temperature: 0.1 });
            const json = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
            decision = JSON.parse(json);
        }
        catch (err) {
            debug('capability-discovery', `Failed to parse decision at iteration ${iteration}: ${err}`);
            break;
        }
        if (decision.capabilitySummary)
            capabilitySummary = decision.capabilitySummary;
        // Fetch requested skill details
        for (const name of (decision.needsSkillDetail ?? [])) {
            if (fetchedSkills.has(name))
                continue;
            const meta = skillMetas.find(m => m.name === name);
            if (meta) {
                try {
                    const detail = await fetchSkillDetail(meta, decision.selectedScript ?? undefined);
                    collectedSkillDetails.push(detail);
                    fetchedSkills.add(name);
                }
                catch (err) {
                    debug('capability-discovery', `Failed to load skill detail for ${name}: ${err}`);
                }
            }
        }
        // Fetch requested node details
        for (const key of (decision.needsNodeDetail ?? [])) {
            if (fetchedNodes.has(key))
                continue;
            const detail = fetchNodeDetail(key, catalog, nodeCodeFactory);
            collectedNodeDetails.push(detail);
            fetchedNodes.add(key);
        }
        // Skill selected — return immediately
        if (decision.selectedSkill) {
            const selectedMeta = skillMetas.find(m => m.name === decision.selectedSkill);
            if (selectedMeta) {
                debug('capability-discovery', `Skill selected: ${decision.selectedSkill} (script: ${decision.selectedScript ?? 'first'})`);
                return {
                    contextSnapshot: buildSnapshot(skillTier1, catalogTier1, collectedSkillDetails, collectedNodeDetails, capabilitySummary),
                    selectedSkill: selectedMeta,
                    selectedScript: decision.selectedScript ?? null,
                };
            }
        }
        if (decision.hasEnoughContext)
            break;
    }
    return {
        contextSnapshot: buildSnapshot(skillTier1, catalogTier1, collectedSkillDetails, collectedNodeDetails, capabilitySummary),
        selectedSkill: null,
        selectedScript: null,
    };
}
function buildSnapshot(skillTier1, catalogTier1, skillDetails, nodeDetails, summary) {
    const parts = [];
    if (summary)
        parts.push(`CAPABILITY SUMMARY: ${summary}`);
    if (skillDetails.length > 0)
        parts.push(`SKILL DETAILS:\n${skillDetails.join('\n\n')}`);
    if (nodeDetails.length > 0)
        parts.push(`NODE DOCUMENTATION:\n${nodeDetails.join('\n\n')}`);
    return parts.join('\n\n');
}
