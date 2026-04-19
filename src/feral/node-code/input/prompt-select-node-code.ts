// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Prompt Select NodeCode
// ─────────────────────────────────────────────────────────────────────────────
//
// Pauses process execution to present the user with a list of choices.
// Stores the selected value in context.  Supports {context_key} interpolation
// in the prompt text.
// ─────────────────────────────────────────────────────────────────────────────

import inquirer from 'inquirer';
import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';

export class PromptSelectNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        {
            key: 'prompt',
            name: 'Prompt',
            description: 'The question to ask the user. Supports {context_key} interpolation.',
            type: 'string',
        },
        {
            key: 'options',
            name: 'Options',
            description: 'Comma-separated list of choices to present.',
            type: 'string',
        },
        {
            key: 'context_path',
            name: 'Context Path',
            description: 'Context key where the selected value will be stored.',
            type: 'string',
            default: 'user_selection',
        },
    ];

    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'User selected a choice.' },
        { status: ResultStatus.STOP, description: 'User cancelled the selection.' },
    ];

    constructor() {
        super(
            'prompt_select',
            'Prompt Select',
            'Present the user with choices and store their selection in context.',
            NodeCodeCategory.DATA,
        );
    }

    async process(context: Context): Promise<Result> {
        const promptTemplate = this.getRequiredConfigValue('prompt') as string;
        const optionsRaw = this.getRequiredConfigValue('options') as string;
        const contextPath = this.getRequiredConfigValue('context_path', 'user_selection') as string;

        const prompt = this.interpolate(promptTemplate, context);
        const choices = optionsRaw.split(',').map(s => s.trim()).filter(Boolean);

        const CANCEL_SENTINEL = '__cancel__';
        const askQuestion = context.get('_askQuestion') as ((q: string, opts?: string[]) => Promise<string>) | null;
        let selection: string;
        if (askQuestion) {
            selection = await askQuestion(prompt, choices);
        } else {
            const result = await inquirer.prompt([{
                type: 'list',
                name: 'selection',
                message: prompt,
                choices,
            }]);
            selection = result.selection as string;
        }

        if (selection === CANCEL_SENTINEL) {
            context.set('_cancelled', true);
            return this.result(ResultStatus.STOP, 'User cancelled.');
        }

        context.set(contextPath, selection);
        return this.result(ResultStatus.OK, `User selected "${selection}", stored in ${contextPath}`);
    }
}
