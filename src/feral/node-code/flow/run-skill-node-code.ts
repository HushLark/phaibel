// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Run Skill NodeCode
// ─────────────────────────────────────────────────────────────────────────────
//
// Runs a named skill's Feral CCF script as an inline sub-process, sharing
// the current context.  The LLM never calls a skill directly — it builds a
// Feral process that includes a run_skill node, keeping everything inside
// the CCF execution model.
//
// If the skill has multiple scripts, specify which one via script_name.
// Defaults to the first script listed in the skill's scripts/ directory.
//
// Requires __process_engine in context (injected by Runner.run()).
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import type { ProcessEngine } from '../../engine/process-engine.js';
import { hydrateProcess } from '../../process/process-json-hydrator.js';
import type { ProcessConfigJson } from '../../process/process-json-hydrator.js';
import { loadSkillMetas, loadSkillScript } from '../../../skills/skill-manager.js';

export class RunSkillNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        {
            key: 'skill_name',
            name: 'Skill Name',
            description: 'Name of the skill to run (matches the name field in SKILL.md frontmatter).',
            type: 'string',
        },
        {
            key: 'script_name',
            name: 'Script Name',
            description: 'Which script to run from the skill\'s scripts/ directory. Defaults to the first available script.',
            type: 'string',
            isOptional: true,
        },
        {
            key: 'output_context_path',
            name: 'Output Context Path',
            description: 'Context key where the skill\'s completion status is written.',
            type: 'string',
            default: 'skill_result',
            isOptional: true,
        },
    ];

    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK,    description: 'Skill script executed successfully.' },
        { status: ResultStatus.ERROR, description: 'Skill not found, has no scripts, or script execution failed.' },
    ];

    constructor() {
        super(
            'run_skill',
            'Run Skill',
            'Execute a skill\'s Feral CCF script as an inline sub-process with shared context.',
            NodeCodeCategory.FLOW,
        );
    }

    async process(context: Context): Promise<Result> {
        const skillName   = this.getRequiredConfigValue('skill_name') as string;
        const scriptName  = this.getOptionalConfigValue('script_name') as string | undefined;
        const outputPath  = (this.getOptionalConfigValue('output_context_path') as string | undefined) ?? 'skill_result';

        const engine = context.get('__process_engine') as ProcessEngine | null;
        if (!engine) {
            return this.result(
                ResultStatus.ERROR,
                'run_skill requires __process_engine in context. Ensure you are running via Runner.run().',
            );
        }

        // Find the skill by name
        let metas;
        try {
            metas = await loadSkillMetas();
        } catch (err) {
            return this.result(ResultStatus.ERROR, `Failed to load skills: ${err instanceof Error ? err.message : String(err)}`);
        }

        const meta = metas.find(m => m.name === skillName);
        if (!meta) {
            return this.result(ResultStatus.ERROR, `Skill "${skillName}" not found. Available: ${metas.map(m => m.name).join(', ') || 'none'}`);
        }

        // Load the skill script
        const script = await loadSkillScript(meta, scriptName);
        if (!script) {
            const available = meta.scriptNames.join(', ') || 'none';
            return this.result(ResultStatus.ERROR, `Skill "${skillName}" has no runnable script. Available scripts: ${available}`);
        }

        // Hydrate the raw process JSON and run it with the shared context
        try {
            const process = hydrateProcess(script.process as unknown as ProcessConfigJson);
            await engine.process(process, context);
            context.set(outputPath, `skill:${skillName}/${script.name}:ok`);
            return this.result(ResultStatus.OK, `Skill "${skillName}" (${script.name}) completed.`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            context.set(outputPath, `skill:${skillName}/${script.name ?? 'unknown'}:error:${msg}`);
            return this.result(ResultStatus.ERROR, `Skill "${skillName}" failed: ${msg}`);
        }
    }
}
