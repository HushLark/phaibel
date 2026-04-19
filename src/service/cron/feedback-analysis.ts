// ─────────────────────────────────────────────────────────────────────────────
// Feedback Analysis — periodic analysis of user reactions to chat responses
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'fs';
import path from 'path';
import { findVaultRoot } from '../../state/manager.js';
import { getLogsDir, getVaultConfigDir } from '../../paths.js';
import { getModelForCapability } from '../../llm/router.js';

interface ReactionEntry {
    chatId: string;
    ts: string;
    reaction: 'positive' | 'negative';
    details: string | null;
    userMessage: string | null;
    botResponse: string | null;
}

export async function analyzeFeedback(): Promise<string> {
    const vaultRoot = await findVaultRoot();
    if (!vaultRoot) return 'skipped (no vault)';

    const logsDir = await getLogsDir();
    let logFiles: string[];
    try {
        logFiles = (await fs.readdir(logsDir)).filter(f => f.endsWith('.log'));
    } catch {
        return 'no log files found';
    }

    const reactions: ReactionEntry[] = [];

    for (const file of logFiles) {
        const chatId = file.replace('.log', '');
        let raw: string;
        try {
            raw = await fs.readFile(path.join(logsDir, file), 'utf-8');
        } catch { continue; }

        const lines = raw.trim().split('\n').filter(Boolean);

        let userMessage: string | null = null;
        let botResponse: string | null = null;
        const fileReactions: Array<{ ts: string; reaction: string; details?: string }> = [];

        for (const line of lines) {
            try {
                const entry = JSON.parse(line);
                if (entry.type === 'start' && entry.data?.userMessage) {
                    userMessage = entry.data.userMessage;
                }
                if (entry.type === 'response' && entry.data?.response) {
                    botResponse = typeof entry.data.response === 'string'
                        ? entry.data.response.slice(0, 500)
                        : null;
                }
                if (entry.type === 'reaction') {
                    fileReactions.push({
                        ts: entry.ts,
                        reaction: entry.data.reaction,
                        details: entry.data.details,
                    });
                }
            } catch { /* skip malformed lines */ }
        }

        for (const r of fileReactions) {
            reactions.push({
                chatId,
                ts: r.ts,
                reaction: r.reaction as 'positive' | 'negative',
                details: r.details || null,
                userMessage,
                botResponse,
            });
        }
    }

    if (reactions.length === 0) {
        return 'no reactions found';
    }

    const positiveCount = reactions.filter(r => r.reaction === 'positive').length;
    const negativeCount = reactions.filter(r => r.reaction === 'negative').length;

    const llm = await getModelForCapability('summarize');

    const response = await llm.chat(
        [{
            role: 'user' as const,
            content: `Analyze the following user feedback reactions from a personal AI agent.

SUMMARY: ${reactions.length} total reactions (${positiveCount} positive, ${negativeCount} negative)

REACTIONS:
${JSON.stringify(reactions, null, 2)}

Provide:
1. Overall satisfaction analysis
2. Common patterns in negative feedback (what types of requests are failing)
3. Common patterns in positive feedback (what's working well)
4. Specific actionable recommendations for improvement
5. Brief executive summary

Format as clean Markdown.`,
        }],
        {
            systemPrompt: 'You are analyzing user feedback for a personal AI agent. Provide actionable, specific insights. Focus on patterns, not individual incidents.',
            temperature: 0.3,
        },
    );

    const configDir = await getVaultConfigDir();
    const summaryPath = path.join(configDir, 'feedback-summary.md');
    const header = `---\nupdated: ${new Date().toISOString()}\nreactions: ${reactions.length}\npositive: ${positiveCount}\nnegative: ${negativeCount}\n---\n\n`;
    await fs.writeFile(summaryPath, header + response);

    return `${reactions.length} reactions analyzed (${positiveCount}+, ${negativeCount}-), summary written`;
}
