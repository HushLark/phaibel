// ─────────────────────────────────────────────────────────────────────────────
// Innovate Cron Job — Vault-local improvement loop
//
// Reads recent execution logs, finds failures, asks the LLM to diagnose and
// propose a vault-local change (process or .vault.md), tests it by replaying
// the failing input, and keeps or reverts based on the result.
// Limited to 3 loops to avoid hogging service resources.
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'fs';
import path from 'path';
import { findVaultRoot } from '../../state/manager.js';
import { readRecentExecutionLogs, type ExecutionLog } from '../../utils/execution-logger.js';
import { getModelForCapability } from '../../llm/router.js';
import { getVaultContext } from '../../context/reader.js';
import { feralChatHeadless } from '../../commands/chat.js';
import { listEntities } from '../../entities/entity.js';
import { parseJsonResponse } from '../../utils/json-parser.js';
import { getProcessesDir, getLogsDir } from '../../paths.js';
import { debug } from '../../utils/debug.js';

const MAX_LOOPS = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface InnovateDiagnosis {
    action: 'update_process' | 'create_process' | 'update_vault_context' | 'none';
    /** For update_process: the key of the process to update */
    processKey?: string;
    /** For create_process / update_process: the full process JSON */
    processJson?: Record<string, unknown>;
    /** For update_vault_context: subdirectory relative to vault root (e.g. "todos") */
    directory?: string;
    /** For update_vault_context: the new .vault.md content */
    content?: string;
    /** What the LLM thinks the root cause is */
    reasoning: string;
    /** Which failing execution this targets */
    targetChatId: string;
    /** The user input to replay for testing */
    replayInput: string;
}

interface LoopResult {
    loop: number;
    targetChatId: string;
    action: string;
    detail: string;
    improved: boolean;
    reasoning: string;
}

interface InnovateLog {
    timestamp: string;
    loops: LoopResult[];
    improvementsApplied: number;
    summary: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry
// ─────────────────────────────────────────────────────────────────────────────

export async function runInnovation(): Promise<string> {
    const vaultRoot = await findVaultRoot();
    if (!vaultRoot) {
        return 'No vault found — skipping innovation';
    }

    // Phase 1: Gather data
    const logs = await readRecentExecutionLogs(7);
    const failures = logs.filter(l => !l.success);

    if (failures.length === 0) {
        return 'No recent failures — nothing to improve';
    }

    const processDir = await getProcessesDir();
    const currentProcesses = await loadProcessFiles(processDir);
    const vaultContext = await getVaultContext();
    const feedbackSummary = await readFeedbackSummary(vaultRoot);

    const loopResults: LoopResult[] = [];
    let improvementsApplied = 0;
    // Track which failures we've already tried so we don't repeat
    const triedChatIds = new Set<string>();

    for (let loop = 0; loop < MAX_LOOPS; loop++) {
        // Pick untried failures for this loop
        const untried = failures.filter(f => !triedChatIds.has(f.chat_id));
        if (untried.length === 0) {
            debug('innovate', `Loop ${loop + 1}: no more untried failures`);
            break;
        }

        debug('innovate', `Loop ${loop + 1}/${MAX_LOOPS}: ${untried.length} untried failures`);

        // Phase 2: Diagnose
        const diagnosis = await diagnose(untried, currentProcesses, vaultContext, feedbackSummary);

        if (diagnosis.action === 'none') {
            loopResults.push({
                loop: loop + 1,
                targetChatId: '',
                action: 'none',
                detail: 'LLM found no actionable improvement',
                improved: false,
                reasoning: diagnosis.reasoning,
            });
            break;
        }

        triedChatIds.add(diagnosis.targetChatId);

        // Phase 3: Apply change (with backup)
        const backup = await applyChange(diagnosis, processDir, vaultRoot);

        // Phase 4: Test by replaying the failing input
        const improved = await testReplay(diagnosis.replayInput, diagnosis.targetChatId);

        // Phase 5: Keep or revert
        const detail = describeChange(diagnosis);
        if (improved) {
            improvementsApplied++;
            // Update in-memory process list if we changed a process
            if (diagnosis.action === 'create_process' || diagnosis.action === 'update_process') {
                await refreshProcessList(currentProcesses, processDir, diagnosis);
            }
            debug('innovate', `Loop ${loop + 1}: KEPT — ${detail}`);
        } else {
            await revertChange(backup);
            debug('innovate', `Loop ${loop + 1}: REVERTED — ${detail}`);
        }

        loopResults.push({
            loop: loop + 1,
            targetChatId: diagnosis.targetChatId,
            action: diagnosis.action,
            detail,
            improved,
            reasoning: diagnosis.reasoning,
        });
    }

    // Write log file
    const summary = buildSummary(loopResults, improvementsApplied);
    await writeInnovateLog(vaultRoot, { loopResults, improvementsApplied, summary });

    return summary;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: LLM Diagnosis
// ─────────────────────────────────────────────────────────────────────────────

async function diagnose(
    failures: ExecutionLog[],
    processes: ProcessFile[],
    vaultContext: string,
    feedbackSummary: string,
): Promise<InnovateDiagnosis> {
    const llm = await getModelForCapability('reason');

    const failureSummaries = failures.slice(0, 10).map(f => ({
        chat_id: f.chat_id,
        user_input: f.user_input,
        process_key: f.process_key,
        process_source: f.process_source,
        outcome_summary: f.outcome_summary,
        process_json: f.process_json,
    }));

    const processSummaries = processes.map(p => ({
        key: p.key,
        description: p.description,
        filename: p.filename,
    }));

    const prompt = `You are the innovation engine for Phaibel, a Personal Digital Agent. Analyze recent failures and propose ONE targeted change to vault-local content to fix the most impactful failure.

RECENT FAILURES (${failures.length}):
${JSON.stringify(failureSummaries, null, 2)}

CURRENT SAVED PROCESSES (${processes.length}):
${JSON.stringify(processSummaries, null, 2)}

VAULT CONTEXT:
${vaultContext || '(none)'}

${feedbackSummary ? `FEEDBACK SUMMARY:\n${feedbackSummary}\n` : ''}
RULES:
- You can ONLY change vault-local content: saved processes (.phaibel/processes/*.json) or .vault.md context files
- Do NOT suggest code changes — that's outside your scope
- Pick the single most impactful failure to fix
- Propose exactly ONE change
- For processes: provide the FULL valid process JSON with schema_version, key, description, context, nodes[], edges[]
- Every process must have a "start" node and a "stop" node
- For .vault.md: provide the full new content for the file
- Use {context_key} interpolation for variable parts in processes

Return a JSON object:
{
    "action": "update_process" | "create_process" | "update_vault_context" | "none",
    "processKey": "key of process to update (for update_process only)",
    "processJson": { ... full process JSON ... },
    "directory": "subdirectory for .vault.md (e.g. 'todos')",
    "content": "new .vault.md content",
    "reasoning": "What you think the root cause is and why this change should help",
    "targetChatId": "chat_id of the failure you're targeting",
    "replayInput": "the user_input to replay for testing"
}

If no actionable improvement is possible, return: { "action": "none", "reasoning": "...", "targetChatId": "", "replayInput": "" }

Return ONLY the JSON object, no markdown fences.`;

    const response = await llm.chat(
        [{ role: 'user' as const, content: prompt }],
        {
            systemPrompt: 'You are a diagnostic engine for improving a Personal Digital Agent. Analyze failures and propose targeted, minimal fixes to vault-local content. Be precise and conservative.',
            temperature: 0.3,
        },
    );

    try {
        return parseJsonResponse(response) as unknown as InnovateDiagnosis;
    } catch {
        return {
            action: 'none',
            reasoning: 'Failed to parse LLM diagnosis response',
            targetChatId: '',
            replayInput: '',
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3: Apply change (with backup for revert)
// ─────────────────────────────────────────────────────────────────────────────

interface Backup {
    filePath: string;
    originalContent: string | null; // null = file didn't exist before
}

async function applyChange(
    diagnosis: InnovateDiagnosis,
    processDir: string,
    vaultRoot: string,
): Promise<Backup> {
    await fs.mkdir(processDir, { recursive: true });

    if (diagnosis.action === 'update_process' && diagnosis.processKey && diagnosis.processJson) {
        const filename = `${diagnosis.processKey.replace(/\./g, '-')}.json`;
        const filepath = path.join(processDir, filename);
        const original = await safeRead(filepath);
        await fs.writeFile(filepath, JSON.stringify(diagnosis.processJson, null, 2));
        return { filePath: filepath, originalContent: original };
    }

    if (diagnosis.action === 'create_process' && diagnosis.processJson) {
        const key = (diagnosis.processJson.key as string) || 'new-process';
        const filename = `${key.replace(/\./g, '-')}.json`;
        const filepath = path.join(processDir, filename);
        const original = await safeRead(filepath);
        await fs.writeFile(filepath, JSON.stringify(diagnosis.processJson, null, 2));
        return { filePath: filepath, originalContent: original };
    }

    if (diagnosis.action === 'update_vault_context' && diagnosis.directory && diagnosis.content) {
        const dir = path.join(vaultRoot, diagnosis.directory);
        await fs.mkdir(dir, { recursive: true });
        const filepath = path.join(dir, '.vault.md');
        const original = await safeRead(filepath);
        await fs.writeFile(filepath, diagnosis.content);
        return { filePath: filepath, originalContent: original };
    }

    return { filePath: '', originalContent: null };
}

async function revertChange(backup: Backup): Promise<void> {
    if (!backup.filePath) return;

    if (backup.originalContent === null) {
        // File didn't exist before — remove it
        try {
            await fs.unlink(backup.filePath);
        } catch {
            // Already gone
        }
    } else {
        await fs.writeFile(backup.filePath, backup.originalContent);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4: Test by replaying
// ─────────────────────────────────────────────────────────────────────────────

async function testReplay(userInput: string, _originalChatId: string): Promise<boolean> {
    if (!userInput) return false;

    try {
        // Snapshot entity counts before
        const entityTypes = ['task', 'event', 'note', 'goal', 'person', 'todont'];
        const beforeCounts: Record<string, number> = {};
        for (const type of entityTypes) {
            try {
                const entities = await listEntities(type as 'task');
                beforeCounts[type] = entities.length;
            } catch {
                beforeCounts[type] = 0;
            }
        }

        // Replay via feralChatHeadless
        const responseText = await Promise.race([
            feralChatHeadless(
                userInput,
                () => {},           // onStatus: no-op
                () => {},           // onProcess: no-op
                async (_q: string, options?: string[]) => {
                    // Auto-answer questions: pick first option or give reasonable default
                    if (options && options.length > 0) return options[0];
                    return '12:00';
                },
                () => {},           // onChatId: no-op
            ),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Replay timed out')), 60_000),
            ),
        ]);

        // Check for improvement signals
        const hasError = /error|fail|invalid|could not|unable to/i.test(responseText);
        const hasValidation = /validation|required field|missing/i.test(responseText);

        // Check if entities were created
        const afterCounts: Record<string, number> = {};
        for (const type of entityTypes) {
            try {
                const entities = await listEntities(type as 'task');
                afterCounts[type] = entities.length;
            } catch {
                afterCounts[type] = 0;
            }
        }

        const entityCreated = entityTypes.some(t => afterCounts[t] > beforeCounts[t]);

        // Score: improved if no errors and either entity was created or response is clean
        const improved = !hasError && !hasValidation && (entityCreated || responseText.length > 20);

        debug('innovate', `Replay result: error=${hasError}, validation=${hasValidation}, entityCreated=${entityCreated}, improved=${improved}`);
        return improved;
    } catch (err) {
        debug('innovate', `Replay failed: ${err instanceof Error ? err.message : err}`);
        return false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface ProcessFile {
    key: string;
    description: string;
    filename: string;
}

async function loadProcessFiles(processDir: string): Promise<ProcessFile[]> {
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
                key: parsed.key || file.replace('.json', ''),
                description: parsed.description || '',
                filename: file,
            });
        } catch {
            // skip invalid
        }
    }
    return processes;
}

async function readFeedbackSummary(vaultRoot: string): Promise<string> {
    try {
        return await fs.readFile(
            path.join(vaultRoot, '.phaibel', 'feedback-summary.md'),
            'utf-8',
        );
    } catch {
        return '';
    }
}

async function safeRead(filepath: string): Promise<string | null> {
    try {
        return await fs.readFile(filepath, 'utf-8');
    } catch {
        return null;
    }
}

function describeChange(diagnosis: InnovateDiagnosis): string {
    switch (diagnosis.action) {
        case 'update_process':
            return `updated process '${diagnosis.processKey}'`;
        case 'create_process':
            return `created process '${(diagnosis.processJson?.key as string) || 'unknown'}'`;
        case 'update_vault_context':
            return `updated ${diagnosis.directory}/.vault.md`;
        default:
            return 'no change';
    }
}

async function refreshProcessList(
    processes: ProcessFile[],
    processDir: string,
    diagnosis: InnovateDiagnosis,
): Promise<void> {
    if (diagnosis.action === 'create_process' && diagnosis.processJson) {
        const key = (diagnosis.processJson.key as string) || 'new-process';
        processes.push({
            key,
            description: (diagnosis.processJson.description as string) || '',
            filename: `${key.replace(/\./g, '-')}.json`,
        });
    }
}

function buildSummary(results: LoopResult[], improvements: number): string {
    const details = results
        .filter(r => r.improved)
        .map(r => r.detail)
        .join(', ');

    if (improvements === 0) {
        return `Innovate: ${results.length} loop(s), no improvements found`;
    }
    return `Innovate: ${results.length} loop(s), ${improvements} improvement(s) applied (${details})`;
}

async function writeInnovateLog(
    vaultRoot: string,
    data: { loopResults: LoopResult[]; improvementsApplied: number; summary: string },
): Promise<void> {
    const logsDir = await getLogsDir();
    await fs.mkdir(logsDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const log: InnovateLog = {
        timestamp: new Date().toISOString(),
        loops: data.loopResults,
        improvementsApplied: data.improvementsApplied,
        summary: data.summary,
    };

    await fs.writeFile(
        path.join(logsDir, `innovate-${timestamp}.json`),
        JSON.stringify(log, null, 2),
    );
}
