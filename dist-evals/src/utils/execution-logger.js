// ─────────────────────────────────────────────────────────────────────────────
// Execution Logger — per-execution JSON logs for process learning
// ─────────────────────────────────────────────────────────────────────────────
import { getPlatform } from '../platform/index.js';
import { getLogsDir } from '../paths.js';
/**
 * Write a single execution log as a JSON file to {vault}/.phaibel/logs/.
 */
export async function writeExecutionLog(log) {
    const { storage, paths } = getPlatform();
    const dir = await getLogsDir();
    await storage.mkdir(dir, { recursive: true });
    const filename = `${log.chat_id}.exec.json`;
    await storage.writeFile(paths.join(dir, filename), JSON.stringify(log, null, 2));
}
/**
 * Read recent execution logs from the vault, filtered by age.
 */
export async function readRecentExecutionLogs(maxAgeDays = 7) {
    const { storage, paths } = getPlatform();
    const dir = await getLogsDir();
    let files;
    try {
        files = await storage.readdir(dir);
    }
    catch {
        return [];
    }
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
    const logs = [];
    for (const file of files) {
        if (!file.endsWith('.exec.json'))
            continue;
        try {
            const raw = await storage.readFile(paths.join(dir, file));
            const log = JSON.parse(raw);
            if (new Date(log.timestamp) >= cutoff) {
                logs.push(log);
            }
        }
        catch {
            // Skip invalid files
        }
    }
    return logs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
