// ─────────────────────────────────────────────────────────────────────────────
// Token Usage Tracker
//
// Stores daily LLM token usage by model in {vault}/.phaibel/token-usage.json.
// Auto-prunes to 30 days. Provides query functions for per-model and aggregate.
// ─────────────────────────────────────────────────────────────────────────────
import { AsyncLocalStorage } from 'node:async_hooks';
import { getPlatform } from '../platform/index.js';
import { getVaultConfigDir } from '../paths.js';
const MAX_DAYS = 30;
// ─────────────────────────────────────────────────────────────────────────────
// FILE I/O
// ─────────────────────────────────────────────────────────────────────────────
async function getUsagePath() {
    const dir = await getVaultConfigDir();
    return getPlatform().paths.join(dir, 'token-usage.json');
}
let _cache = null;
async function loadUsage() {
    if (_cache)
        return _cache;
    try {
        const raw = await getPlatform().storage.readFile(await getUsagePath());
        _cache = JSON.parse(raw);
        return _cache;
    }
    catch {
        _cache = {};
        return _cache;
    }
}
async function saveUsage(data) {
    const { storage } = getPlatform();
    const dir = await getVaultConfigDir();
    await storage.mkdir(dir, { recursive: true });
    await storage.writeFile(await getUsagePath(), JSON.stringify(data, null, 2));
    _cache = data;
}
function prune(data) {
    const dates = Object.keys(data).sort();
    if (dates.length <= MAX_DAYS)
        return data;
    const cutoff = dates[dates.length - MAX_DAYS];
    const pruned = {};
    for (const date of dates) {
        if (date >= cutoff)
            pruned[date] = data[date];
    }
    return pruned;
}
// ─────────────────────────────────────────────────────────────────────────────
// RECORDING
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Record token usage for a single LLM call.
 * Called by providers after each API call.
 * Also feeds the analytics service for cost tracking.
 */
export async function recordUsage(model, inputTokens, outputTokens) {
    const data = await loadUsage();
    const today = new Date().toISOString().split('T')[0];
    if (!data[today])
        data[today] = {};
    if (!data[today][model])
        data[today][model] = { inputTokens: 0, outputTokens: 0, calls: 0 };
    data[today][model].inputTokens += inputTokens;
    data[today][model].outputTokens += outputTokens;
    data[today][model].calls += 1;
    // Feed per-chat tracker if active
    feedChatTracker(inputTokens, outputTokens);
    const pruned = prune(data);
    await saveUsage(pruned);
    // Feed analytics (fire-and-forget)
    import('../analytics/analytics-service.js')
        .then(({ getAnalyticsService }) => getAnalyticsService().recordTokens(model, inputTokens, outputTokens))
        .catch(() => { });
}
// ─────────────────────────────────────────────────────────────────────────────
// QUERYING
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Get usage for a specific model over the last N days.
 */
export async function getModelUsage(model, days = 30) {
    const data = await loadUsage();
    const results = [];
    const dates = Object.keys(data).sort().slice(-days);
    for (const date of dates) {
        const entry = data[date][model];
        if (entry) {
            results.push({
                date,
                model,
                inputTokens: entry.inputTokens,
                outputTokens: entry.outputTokens,
                totalTokens: entry.inputTokens + entry.outputTokens,
                calls: entry.calls,
            });
        }
    }
    return results;
}
/**
 * Get usage for all models over the last N days.
 */
export async function getAllUsage(days = 30) {
    const data = await loadUsage();
    const results = [];
    const dates = Object.keys(data).sort().slice(-days);
    for (const date of dates) {
        for (const [model, entry] of Object.entries(data[date])) {
            results.push({
                date,
                model,
                inputTokens: entry.inputTokens,
                outputTokens: entry.outputTokens,
                totalTokens: entry.inputTokens + entry.outputTokens,
                calls: entry.calls,
            });
        }
    }
    return results;
}
/**
 * Get daily totals (all models combined) over the last N days.
 */
export async function getDailyTotals(days = 30) {
    const data = await loadUsage();
    const results = [];
    const dates = Object.keys(data).sort().slice(-days);
    for (const date of dates) {
        let inputTokens = 0;
        let outputTokens = 0;
        let calls = 0;
        for (const entry of Object.values(data[date])) {
            inputTokens += entry.inputTokens;
            outputTokens += entry.outputTokens;
            calls += entry.calls;
        }
        results.push({
            date,
            model: 'all',
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
            calls,
        });
    }
    return results;
}
/**
 * Get list of all models that have recorded usage.
 */
export async function getTrackedModels() {
    const data = await loadUsage();
    const models = new Set();
    for (const day of Object.values(data)) {
        for (const model of Object.keys(day)) {
            models.add(model);
        }
    }
    return [...models].sort();
}
const chatTokenStore = new AsyncLocalStorage();
/**
 * Called by recordUsage to feed the active per-chat tracker (if any).
 */
function feedChatTracker(inputTokens, outputTokens) {
    const tracker = chatTokenStore.getStore();
    if (tracker) {
        tracker.inputTokens += inputTokens;
        tracker.outputTokens += outputTokens;
        tracker.totalTokens += inputTokens + outputTokens;
    }
}
/**
 * Run an async function with per-chat token tracking.
 * Returns both the function's result and accumulated token totals.
 */
export async function runWithTokenTracker(fn) {
    const tokens = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const result = await chatTokenStore.run(tokens, fn);
    return { result, tokens };
}
