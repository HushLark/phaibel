// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Prompt Input NodeCode
// ─────────────────────────────────────────────────────────────────────────────
//
// Pauses process execution to ask the user a question via the terminal.
// Stores the answer in context.  Supports {context_key} interpolation
// in the prompt text so the question can reference previous context values.
// ─────────────────────────────────────────────────────────────────────────────

import inquirer from 'inquirer';
import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';

export class PromptInputNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        {
            key: 'prompt',
            name: 'Prompt',
            description: 'The question to ask the user. Supports {context_key} interpolation.',
            type: 'string',
        },
        {
            key: 'context_path',
            name: 'Context Path',
            description: 'Context key where the user\'s answer will be stored.',
            type: 'string',
            default: 'user_answer',
        },
        {
            key: 'default_value',
            name: 'Default Value',
            description: 'Optional default value shown to the user.',
            type: 'string',
            isOptional: true,
        },
    ];

    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'User provided an answer.' },
        { status: 'skipped', description: 'User provided no answer (empty input).' },
        { status: ResultStatus.STOP, description: 'User cancelled the prompt.' },
    ];

    constructor() {
        super(
            'prompt_input',
            'Prompt Input',
            'Ask the user a question and store their answer in context.',
            NodeCodeCategory.DATA,
        );
    }

    async process(context: Context): Promise<Result> {
        const promptTemplate = this.getRequiredConfigValue('prompt') as string;
        const contextPath = this.getRequiredConfigValue('context_path', 'user_answer') as string;
        const defaultValue = this.getOptionalConfigValue('default_value') as string | null;

        // Interpolate {context_key} tokens
        const prompt = this.interpolate(promptTemplate, context);

        const CANCEL_SENTINEL = '__cancel__';
        const askQuestion = context.get('_askQuestion') as ((q: string, opts?: string[]) => Promise<string>) | null;
        let trimmed: string;
        if (askQuestion) {
            trimmed = ((await askQuestion(prompt)) ?? '').trim();
        } else {
            const { answer } = await inquirer.prompt([{
                type: 'input',
                name: 'answer',
                message: prompt,
                ...(defaultValue ? { default: this.interpolate(defaultValue, context) } : {}),
            }]);
            trimmed = (answer as string).trim();
        }

        if (trimmed === CANCEL_SENTINEL) {
            context.set('_cancelled', true);
            return this.result(ResultStatus.STOP, 'User cancelled.');
        }

        if (!trimmed) {
            return this.result('skipped', 'User provided no answer.');
        }

        context.set(contextPath, trimmed);
        return this.result(ResultStatus.OK, `Stored "${trimmed}" in ${contextPath}`);
    }
}
