// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — A2A Send Task NodeCode
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { a2aClient } from '../../../agents/a2a-client.js';

export class A2ASendTaskNodeCode extends AbstractNodeCode {
    readonly allowExtraConfig = true;

    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'agent_id', name: 'Agent ID', description: 'The A2A agent ID to send the task to.', type: 'string' },
        { key: 'agent_name', name: 'Agent Name', description: 'Display name of the remote agent.', type: 'string', isOptional: true },
        { key: 'skill_id', name: 'Skill ID', description: 'Optional skill to invoke on the remote agent.', type: 'string', isOptional: true },
        { key: 'message_context_path', name: 'Message Path', description: 'Context key containing the message text to send.', type: 'string', default: 'user_message' },
        { key: 'data_context_path', name: 'Data Path', description: 'Context key containing structured data to include.', type: 'string', isOptional: true },
        { key: 'response_context_path', name: 'Response Path', description: 'Context key to store the agent response text.', type: 'string', default: 'a2a_response' },
        { key: 'task_context_path', name: 'Task Path', description: 'Context key to store the full task result object.', type: 'string', isOptional: true },
    ];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'A2A task completed successfully.' },
        { status: ResultStatus.ERROR, description: 'A2A task failed or agent returned an error.' },
    ];

    constructor() {
        super('a2a_send_task', 'A2A Send Task', 'Send a task to a remote A2A agent.', NodeCodeCategory.DATA);
    }

    async process(context: Context): Promise<Result> {
        const agentId = this.getRequiredConfigValue('agent_id') as string;
        const agentName = this.getOptionalConfigValue('agent_name') as string | null;
        const skillId = this.getOptionalConfigValue('skill_id') as string | null;
        const messagePath = this.getRequiredConfigValue('message_context_path', 'user_message') as string;
        const dataPath = this.getOptionalConfigValue('data_context_path') as string | null;
        const responsePath = this.getRequiredConfigValue('response_context_path', 'a2a_response') as string;
        const taskPath = this.getOptionalConfigValue('task_context_path') as string | null;

        // Get message from context
        const message = context.has(messagePath)
            ? String(context.get(messagePath))
            : '';

        // Get optional structured data
        let data: Record<string, unknown> | undefined;
        if (dataPath && context.has(dataPath)) {
            const raw = context.get(dataPath);
            data = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : undefined;
        }

        const label = agentName || agentId;

        try {
            const result = await a2aClient.sendTask(agentId, message, {
                skillId: skillId || undefined,
                data,
            });

            // Store full task result if requested
            if (taskPath) {
                context.set(taskPath, result);
            }

            // Extract text response from artifacts or history
            const responseText = extractTextResponse(result);
            context.set(responsePath, responseText);

            if (result.status.state === 'failed') {
                return this.result(ResultStatus.ERROR, `Agent "${label}" task failed: ${responseText}`);
            }

            return this.result(ResultStatus.OK, `Agent "${label}" responded successfully.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.result(ResultStatus.ERROR, `A2A call to "${label}" failed: ${message}`);
        }
    }
}

/**
 * Extract text from A2A task result — looks at artifacts first, then history.
 */
function extractTextResponse(result: {
    artifacts?: Array<{ parts: Array<{ type: string; text?: string }> }>;
    history?: Array<{ role: string; parts: Array<{ type: string; text?: string }> }>;
}): string {
    // Try artifacts first
    if (result.artifacts) {
        const texts = result.artifacts
            .flatMap(a => a.parts)
            .filter(p => p.type === 'text' && p.text)
            .map(p => p.text!);
        if (texts.length > 0) return texts.join('\n');
    }

    // Fall back to last agent message in history
    if (result.history) {
        const agentMessages = result.history.filter(m => m.role === 'agent');
        if (agentMessages.length > 0) {
            const last = agentMessages[agentMessages.length - 1];
            const texts = last.parts
                .filter(p => p.type === 'text' && p.text)
                .map(p => p.text!);
            if (texts.length > 0) return texts.join('\n');
        }
    }

    return '';
}
