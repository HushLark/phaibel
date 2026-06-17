// ─────────────────────────────────────────────────────────────────────────────
// Debug Trace — collects pipeline telemetry and formats it as Markdown
// ─────────────────────────────────────────────────────────────────────────────

export interface LlmCallRecord {
    step: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    systemExcerpt: string;
    userExcerpt: string;
    responseExcerpt: string;
}

export interface ProcessNodeRecord {
    nodeKey: string;
    durationMs: number;
    status: string;
    message: string;
}

export interface DebugTraceData {
    chatId: string;
    timestamp: string;
    userInput: string;
    classification?: Record<string, unknown>;
    contextSummary?: string;
    processSource?: string;     // 'category' | 'reuse' | 'custom'
    processKey?: string;
    processJson?: Record<string, unknown>;
    processNodes?: ProcessNodeRecord[];
    contextValues?: Record<string, unknown>;
    outcome: string;
    totalTokens: { input: number; output: number };
    llmCalls: LlmCallRecord[];
}

export class DebugTraceCollector {
    private data: DebugTraceData;

    constructor(chatId: string, userInput: string) {
        this.data = {
            chatId,
            timestamp: new Date().toISOString(),
            userInput,
            llmCalls: [],
            outcome: '',
            totalTokens: { input: 0, output: 0 },
        };
    }

    setClassification(c: Record<string, unknown>): void {
        this.data.classification = c;
    }

    setContextSummary(s: string): void {
        this.data.contextSummary = s;
    }

    setProcess(source: string, key: string, json?: Record<string, unknown>): void {
        this.data.processSource = source;
        this.data.processKey = key;
        this.data.processJson = json;
    }

    setProcessNodes(nodes: ProcessNodeRecord[]): void {
        this.data.processNodes = nodes;
    }

    setContextValues(v: Record<string, unknown>): void {
        this.data.contextValues = v;
    }

    setOutcome(response: string, tokens: { input: number; output: number }): void {
        this.data.outcome = response;
        this.data.totalTokens = tokens;
    }

    addLlmCall(call: LlmCallRecord): void {
        this.data.llmCalls.push(call);
    }

    getData(): Readonly<DebugTraceData> {
        return this.data;
    }

    formatMarkdown(): string {
        const d = this.data;
        const parts: string[] = [];

        parts.push(`# Debug Trace: ${d.chatId}`);
        parts.push(`**Timestamp:** ${d.timestamp}`);
        parts.push('');

        parts.push('## User Prompt');
        parts.push('```');
        parts.push(d.userInput);
        parts.push('```');
        parts.push('');

        if (d.classification) {
            parts.push('## Classification');
            parts.push('```json');
            parts.push(JSON.stringify(d.classification, null, 2));
            parts.push('```');
            parts.push('');
        }

        if (d.contextSummary) {
            parts.push('## Context Summary');
            parts.push(d.contextSummary);
            parts.push('');
        }

        if (d.processKey) {
            const src = d.processSource ? ` (source: ${d.processSource})` : '';
            parts.push(`## Feral Process: \`${d.processKey}\`${src}`);
            if (d.processJson && Object.keys(d.processJson).length > 0) {
                const jsonStr = JSON.stringify(d.processJson, null, 2);
                parts.push('```json');
                parts.push(jsonStr.length > 8000 ? jsonStr.slice(0, 8000) + '\n… [truncated]' : jsonStr);
                parts.push('```');
            }
            parts.push('');
        }

        if (d.processNodes && d.processNodes.length > 0) {
            parts.push('## Process Execution Trace');
            parts.push('| Node | Duration | Status | Message |');
            parts.push('|------|----------|--------|---------|');
            for (const n of d.processNodes) {
                const msg = n.message.replace(/\|/g, '\\|').slice(0, 100);
                parts.push(`| \`${n.nodeKey}\` | ${n.durationMs}ms | ${n.status} | ${msg} |`);
            }
            parts.push('');
        }

        if (d.contextValues && Object.keys(d.contextValues).length > 0) {
            parts.push('## Feral Context After Execution');
            const cv = JSON.stringify(d.contextValues, null, 2);
            parts.push('```json');
            parts.push(cv.length > 12000 ? cv.slice(0, 12000) + '\n… [truncated]' : cv);
            parts.push('```');
            parts.push('');
        }

        if (d.llmCalls.length > 0) {
            parts.push('## LLM Pipeline Calls');
            for (let i = 0; i < d.llmCalls.length; i++) {
                const call = d.llmCalls[i];
                parts.push(`### Call ${i + 1}: ${call.step} (${call.model})`);
                parts.push(`**Tokens:** ${call.inputTokens} in / ${call.outputTokens} out`);
                if (call.systemExcerpt) {
                    parts.push('**System (excerpt):**');
                    parts.push('```');
                    parts.push(call.systemExcerpt);
                    parts.push('```');
                }
                if (call.userExcerpt) {
                    parts.push('**User message (excerpt):**');
                    parts.push('```');
                    parts.push(call.userExcerpt);
                    parts.push('```');
                }
                if (call.responseExcerpt) {
                    parts.push('**Response (excerpt):**');
                    parts.push('```');
                    parts.push(call.responseExcerpt);
                    parts.push('```');
                }
                parts.push('');
            }
        }

        parts.push('## Outcome');
        parts.push(`**Total tokens:** ${d.totalTokens.input} in / ${d.totalTokens.output} out`);
        parts.push('');
        parts.push('**Response:**');
        parts.push('```');
        parts.push(d.outcome);
        parts.push('```');

        return parts.join('\n');
    }
}
