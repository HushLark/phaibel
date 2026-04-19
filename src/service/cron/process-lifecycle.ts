// ─────────────────────────────────────────────────────────────────────────────
// Process Lifecycle Manager — creates, updates, and retires reusable processes
// from execution logs. Runs as an hourly cron job.
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'fs';
import path from 'path';
import { findVaultRoot } from '../../state/manager.js';
import { readRecentExecutionLogs, type ExecutionLog } from '../../utils/execution-logger.js';
import { parseJsonResponse } from '../../utils/json-parser.js';
import { getModelForCapability } from '../../llm/router.js';

interface ProcessFile {
    key: string;
    description: string;
    filename: string;
    json: Record<string, unknown>;
}

interface UsageStats {
    key: string;
    timesUsed: number;
    successRate: number;
    lastUsed: string | null;
}

interface LifecycleDecision {
    create: Array<{
        key: string;
        description: string;
        process: Record<string, unknown>;
    }>;
    update: Array<{
        key: string;
        description: string;
        process: Record<string, unknown>;
    }>;
    retire: Array<{
        key: string;
        reason: string;
    }>;
    reasoning: string;
}

/**
 * Full lifecycle evaluation: create new processes, update underperformers,
 * and retire broken/unused ones.
 */
export async function evaluateProcessLifecycle(): Promise<string> {
    const vaultRoot = await findVaultRoot();
    if (!vaultRoot) {
        return 'No vault found — skipping process lifecycle';
    }

    // 1. Collect data
    const logs = await readRecentExecutionLogs(14);
    const processDir = path.join(vaultRoot, 'processes');
    const existingProcesses = await loadProcesses(processDir);

    const customLogs = logs.filter(l => l.process_source === 'custom');
    const reuseLogs = logs.filter(l => l.process_source === 'reuse');

    if (customLogs.length < 2 && existingProcesses.length === 0) {
        return `Not enough data — ${customLogs.length} custom log(s), 0 processes`;
    }

    // 2. Compute usage stats per existing process
    const stats = computeUsageStats(existingProcesses, reuseLogs);

    // 3. Send to LLM
    const llm = await getModelForCapability('reason');

    const existingProcessSummaries = existingProcesses.map(p => ({
        key: p.key,
        description: p.description,
        process: p.json,
    }));

    const statsSection = stats.length > 0
        ? stats.map(s =>
            `- ${s.key}: used ${s.timesUsed}x, ${Math.round(s.successRate * 100)}% success, last used ${s.lastUsed ?? 'never'}`
        ).join('\n')
        : 'No usage data yet';

    const customLogSummaries = customLogs.map(l => ({
        user_input: l.user_input,
        success: l.success,
        outcome_summary: l.outcome_summary,
        process_json: l.process_json,
    }));

    const reuseLogSummaries = reuseLogs.map(l => ({
        process_key: l.process_key,
        success: l.success,
        outcome_summary: l.outcome_summary,
    }));

    const response = await llm.chat(
        [{
            role: 'user' as const,
            content: `EXISTING PROCESSES (${existingProcesses.length}):
${JSON.stringify(existingProcessSummaries, null, 2)}

USAGE STATS (last 14 days):
${statsSection}

RECENT CUSTOM EXECUTIONS (${customLogs.length}):
${JSON.stringify(customLogSummaries, null, 2)}

RECENT REUSE EXECUTIONS (${reuseLogs.length}):
${JSON.stringify(reuseLogSummaries, null, 2)}

RULES:
- CREATE when 2+ similar custom executions show a repeatable pattern
- UPDATE when an existing process has success rate < 70%, or custom logs show a better approach for the same task
- RETIRE when a process is unused for 14+ days, or always failing — but never retire processes less than 3 days old
- Use {context_key} interpolation for variable parts (e.g. {user_input}, {entity_title})
- Prefer simple, focused processes (5-8 nodes max)
- Every process must start with a "start" node and end with a "stop" node
- Process key should be descriptive (e.g. "create-task-with-tag", "list-events-today")
- Don't create duplicates of existing processes

Return a JSON object:
{
    "create": [
        { "key": "process-key", "description": "What it does", "process": { ... valid process JSON ... } }
    ],
    "update": [
        { "key": "existing-key", "description": "Updated description", "process": { ... improved process JSON ... } }
    ],
    "retire": [
        { "key": "existing-key", "reason": "Why it should be retired" }
    ],
    "reasoning": "Overall analysis"
}

If no actions needed, return empty arrays. Return ONLY the JSON object, no markdown fences.`,
        }],
        {
            systemPrompt: 'You are the process lifecycle engine for Phaibel, a Personal Digital Agent. Analyze execution logs and process performance to create new processes, improve underperforming ones, and retire broken or unused ones. Quality over quantity — only act when the data clearly supports it.',
            temperature: 0.3,
        },
    );

    // 4. Parse LLM response
    let decision: LifecycleDecision;
    try {
        decision = parseJsonResponse(response) as unknown as LifecycleDecision;
    } catch {
        return 'Failed to parse LLM response for process lifecycle';
    }

    // Normalize missing arrays
    decision.create = decision.create ?? [];
    decision.update = decision.update ?? [];
    decision.retire = decision.retire ?? [];

    const totalActions = decision.create.length + decision.update.length + decision.retire.length;
    if (totalActions === 0) {
        return `No lifecycle actions needed: ${decision.reasoning}`;
    }

    // 5. Execute decisions
    await fs.mkdir(processDir, { recursive: true });
    const existingKeys = new Set(existingProcesses.map(p => p.key));
    let created = 0;
    let updated = 0;
    let retired = 0;

    // Create new processes
    for (const np of decision.create) {
        if (existingKeys.has(np.key)) continue;
        const filename = `${np.key.replace(/\./g, '-')}.json`;
        const filepath = path.join(processDir, filename);
        try {
            await fs.access(filepath);
            continue; // file exists, skip
        } catch {
            // file doesn't exist, proceed
        }
        await fs.writeFile(filepath, JSON.stringify(np.process, null, 2));
        created++;
    }

    // Update existing processes
    for (const up of decision.update) {
        const existing = existingProcesses.find(p => p.key === up.key);
        if (!existing) continue;
        const filepath = path.join(processDir, existing.filename);
        await fs.writeFile(filepath, JSON.stringify(up.process, null, 2));
        updated++;
    }

    // Retire processes (soft delete to .trash)
    for (const rt of decision.retire) {
        const existing = existingProcesses.find(p => p.key === rt.key);
        if (!existing) continue;
        const src = path.join(processDir, existing.filename);
        const trashDir = path.join(vaultRoot, '.trash', 'processes');
        await fs.mkdir(trashDir, { recursive: true });
        const dest = path.join(trashDir, existing.filename);
        await fs.rename(src, dest);
        retired++;
    }

    return `Lifecycle: ${created} created, ${updated} updated, ${retired} retired. ${decision.reasoning}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function loadProcesses(processDir: string): Promise<ProcessFile[]> {
    let files: string[];
    try {
        files = await fs.readdir(processDir);
    } catch {
        return [];
    }

    const processes: ProcessFile[] = [];
    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
            const raw = await fs.readFile(path.join(processDir, file), 'utf-8');
            const parsed = JSON.parse(raw);
            processes.push({
                key: parsed.key,
                description: parsed.description || '',
                filename: file,
                json: parsed,
            });
        } catch {
            // skip invalid files
        }
    }
    return processes;
}

function computeUsageStats(processes: ProcessFile[], reuseLogs: ExecutionLog[]): UsageStats[] {
    return processes.map(p => {
        const matching = reuseLogs.filter(l => l.process_key === p.key);
        const successes = matching.filter(l => l.success).length;
        const lastLog = matching.length > 0
            ? matching[matching.length - 1].timestamp
            : null;
        return {
            key: p.key,
            timesUsed: matching.length,
            successRate: matching.length > 0 ? successes / matching.length : 1,
            lastUsed: lastLog,
        };
    });
}
