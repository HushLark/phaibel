// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — MCP Call Tool NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { mcpManager } from '../../../skills/mcp-manager.js';
export class McpCallToolNodeCode extends AbstractNodeCode {
    allowExtraConfig = true;
    static configDescriptions = [
        { key: 'skill_id', name: 'Skill ID', description: 'The MCP skill server ID.', type: 'string' },
        { key: 'tool_name', name: 'Tool Name', description: 'The tool name to call on the MCP server.', type: 'string' },
        { key: 'arguments_context_path', name: 'Arguments Context Path', description: 'Context key containing the tool arguments object.', type: 'string', isOptional: true },
        { key: 'response_context_path', name: 'Response Path', description: 'Context key to store the MCP tool response.', type: 'string', default: 'mcp_response' },
    ];
    static resultDescriptions = [
        { status: ResultStatus.OK, description: 'MCP tool call completed successfully.' },
        { status: ResultStatus.ERROR, description: 'MCP tool call failed.' },
    ];
    constructor() {
        super('mcp_call_tool', 'MCP Call Tool', 'Call a tool on an MCP skill server.', NodeCodeCategory.DATA);
    }
    async process(context) {
        const skillId = this.getRequiredConfigValue('skill_id');
        const toolName = this.getRequiredConfigValue('tool_name');
        const argsPath = this.getOptionalConfigValue('arguments_context_path');
        const responsePath = this.getRequiredConfigValue('response_context_path', 'mcp_response');
        // Known config keys that are NOT tool arguments
        const reservedKeys = new Set(['skill_id', 'tool_name', 'arguments_context_path', 'response_context_path', '_input_schema']);
        let args = {};
        // 1. Load args from context path if specified
        if (argsPath && context.has(argsPath)) {
            const raw = context.get(argsPath);
            args = typeof raw === 'object' && raw !== null ? raw : {};
        }
        // 2. Extract tool arguments from extra config keys (LLM puts params directly in config)
        const allConfig = this.configManager.getAll();
        for (const [key, cv] of allConfig) {
            if (reservedKeys.has(key))
                continue;
            const val = cv.value ?? cv.default;
            if (val != null) {
                // Interpolate string values from context (supports {user_input} etc.)
                const resolved = typeof val === 'string' ? this.interpolate(val, context) : val;
                args[key] = resolved;
            }
        }
        try {
            const result = await mcpManager.callTool(skillId, toolName, args);
            context.set(responsePath, result);
            return this.result(ResultStatus.OK, `MCP tool ${skillId}/${toolName} called successfully.`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.result(ResultStatus.ERROR, `MCP tool ${skillId}/${toolName} failed: ${message}`);
        }
    }
}
