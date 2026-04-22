// ─────────────────────────────────────────────────────────────────────────────
// Feral Slack — SlackProcessSlashCommand NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { AbstractNodeCode } from '../../node-code/abstract-node-code.js';
import { NodeCodeCategory } from '../../node-code/node-code.js';
import { ResultStatus } from '../../result/result.js';
import { SlashCommandInput, parseUrlEncodedBody } from '../../slack/slash-command-input.js';
/**
 * Parses a URL-encoded POST body from a Slack slash command
 * into a SlashCommandInput DTO and stores it in context.
 */
export class SlackProcessSlashCommandNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'body_context_path', name: 'Body Path', description: 'Context path containing the raw POST body', type: 'string', isOptional: true, default: 'request_body' },
        { key: 'command_context_path', name: 'Command Path', description: 'Context path to store the parsed command', type: 'string', isOptional: true, default: 'slash_command' },
    ];
    constructor() {
        super('process_slash_command', 'Process Slash Command', 'Parses a Slack slash command POST body into a structured DTO', NodeCodeCategory.DATA);
    }
    async process(context) {
        const bodyPath = this.getOptionalConfigValue('body_context_path', 'request_body');
        const commandPath = this.getOptionalConfigValue('command_context_path', 'slash_command');
        if (!context.has(bodyPath)) {
            return this.result(ResultStatus.ERROR, `No POST body found at context path "${bodyPath}"`);
        }
        const rawBody = context.get(bodyPath);
        try {
            const parsed = parseUrlEncodedBody(rawBody);
            const command = new SlashCommandInput(parsed);
            context.set(commandPath, command);
            return this.result(ResultStatus.OK, `Parsed slash command: ${command.command} "${command.text}"`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.result(ResultStatus.ERROR, `Slash command parse error: ${message}`);
        }
    }
}
