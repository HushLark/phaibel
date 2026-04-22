// ─────────────────────────────────────────────────────────────────────────────
// Phaibel Analytics — Service
// ─────────────────────────────────────────────────────────────────────────────
// Tracks daily usage metrics: chats, tokens, costs, entity counts.
// Stored in {vault}/.phaibel/analytics.json. Auto-prunes to 90 days.
// ─────────────────────────────────────────────────────────────────────────────
import { getPlatform } from '../platform/index.js';
import { getVaultConfigDir } from '../paths.js';
const MAX_DAYS = 90;
// ── Model Pricing (USD per 1M tokens) ───────────────────────────────────────
const MODEL_PRICING = {
    // OpenAI
    'gpt-4o': { inputPerMillion: 2.50, outputPerMillion: 10.00 },
    'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.60 },
    'text-embedding-3-small': { inputPerMillion: 0.02, outputPerMillion: 0.00 },
    // Anthropic
    'claude-opus-4-6': { inputPerMillion: 15.00, outputPerMillion: 75.00 },
    'claude-sonnet-4-6': { inputPerMillion: 3.00, outputPerMillion: 15.00 },
    'claude-haiku-4-5-20251001': { inputPerMillion: 0.80, outputPerMillion: 4.00 },
    // DeepSeek
    'deepseek-reasoner': { inputPerMillion: 0.55, outputPerMillion: 2.19 },
    'deepseek-chat': { inputPerMillion: 0.27, outputPerMillion: 1.10 },
    // Google Gemini
    'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 10.00 },
    'gemini-2.5-flash': { inputPerMillion: 0.15, outputPerMillion: 0.60 },
};
const DEFAULT_PRICING = { inputPerMillion: 1.00, outputPerMillion: 3.00 };
// ── File I/O ─────────────────────────────────────────────────────────────────
async function getAnalyticsPath() {
    const dir = await getVaultConfigDir();
    return getPlatform().paths.join(dir, 'analytics.json');
}
let _cache = null;
async function loadAnalytics() {
    if (_cache)
        return _cache;
    try {
        const raw = await getPlatform().storage.readFile(await getAnalyticsPath());
        _cache = JSON.parse(raw);
        return _cache;
    }
    catch {
        _cache = { version: 1, days: {} };
        return _cache;
    }
}
async function saveAnalytics(data) {
    const { storage } = getPlatform();
    const dir = await getVaultConfigDir();
    await storage.mkdir(dir, { recursive: true });
    await storage.writeFile(await getAnalyticsPath(), JSON.stringify(data, null, 2));
    _cache = data;
}
function prune(data) {
    const dates = Object.keys(data.days).sort();
    if (dates.length <= MAX_DAYS)
        return data;
    const cutoff = dates[dates.length - MAX_DAYS];
    const pruned = { version: 1, days: {} };
    for (const date of dates) {
        if (date >= cutoff)
            pruned.days[date] = data.days[date];
    }
    return pruned;
}
function today() {
    return new Date().toISOString().split('T')[0];
}
function ensureDay(data, date) {
    if (!data.days[date]) {
        data.days[date] = {
            date,
            chats: 0,
            tokens: { input: 0, output: 0, total: 0 },
            estimatedCostUsd: 0,
            calls: 0,
            entities: { total: 0, byType: {}, created: 0 },
        };
    }
    return data.days[date];
}
// ── Cost Estimation ──────────────────────────────────────────────────────────
export function estimateCost(model, inputTokens, outputTokens) {
    const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
    return (inputTokens * pricing.inputPerMillion + outputTokens * pricing.outputPerMillion) / 1_000_000;
}
// ── Recording ────────────────────────────────────────────────────────────────
export class AnalyticsService {
    /** Record a new chat session. */
    async recordChat() {
        const data = await loadAnalytics();
        const day = ensureDay(data, today());
        day.chats += 1;
        await saveAnalytics(prune(data));
    }
    /** Record token usage from an LLM call. */
    async recordTokens(model, inputTokens, outputTokens) {
        const data = await loadAnalytics();
        const day = ensureDay(data, today());
        day.tokens.input += inputTokens;
        day.tokens.output += outputTokens;
        day.tokens.total += inputTokens + outputTokens;
        day.calls += 1;
        day.estimatedCostUsd += estimateCost(model, inputTokens, outputTokens);
        // Round to avoid floating point drift
        day.estimatedCostUsd = Math.round(day.estimatedCostUsd * 1_000_000) / 1_000_000;
        await saveAnalytics(prune(data));
    }
    /** Record a skill execution. */
    async recordSkillRun(skillName, success) {
        const data = await loadAnalytics();
        const day = ensureDay(data, today());
        if (!day.skills) {
            day.skills = { runs: 0, errors: 0, bySkill: {} };
        }
        day.skills.runs += 1;
        if (!success)
            day.skills.errors += 1;
        if (!day.skills.bySkill[skillName]) {
            day.skills.bySkill[skillName] = { runs: 0, errors: 0 };
        }
        day.skills.bySkill[skillName].runs += 1;
        if (!success)
            day.skills.bySkill[skillName].errors += 1;
        await saveAnalytics(prune(data));
    }
    /** Record an entity creation event. */
    async recordEntityCreated(entityType) {
        const data = await loadAnalytics();
        const day = ensureDay(data, today());
        day.entities.created += 1;
        await saveAnalytics(prune(data));
    }
    /** Snapshot current entity counts (called periodically, e.g. by cron or at startup). */
    async snapshotEntityCounts(counts) {
        const data = await loadAnalytics();
        const day = ensureDay(data, today());
        day.entities.byType = counts;
        day.entities.total = Object.values(counts).reduce((sum, n) => sum + n, 0);
        await saveAnalytics(prune(data));
    }
    // ── Querying ─────────────────────────────────────────────────────────
    /** Get the daily snapshot for a specific date. */
    async getDay(date) {
        const data = await loadAnalytics();
        return data.days[date] ?? null;
    }
    /** Get today's snapshot. */
    async getToday() {
        const data = await loadAnalytics();
        return ensureDay(data, today());
    }
    /** Get all daily snapshots over the last N days. */
    async getDays(days = 30) {
        const data = await loadAnalytics();
        const dates = Object.keys(data.days).sort().slice(-days);
        return dates.map(d => data.days[d]);
    }
    /** Get an aggregated summary over the last N days. */
    async getSummary(days = 30) {
        const data = await loadAnalytics();
        const dates = Object.keys(data.days).sort().slice(-days);
        const snapshots = dates.map(d => data.days[d]);
        let totalChats = 0;
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let totalCalls = 0;
        let totalCost = 0;
        let totalCreated = 0;
        let totalSkillRuns = 0;
        let totalSkillErrors = 0;
        for (const s of snapshots) {
            totalChats += s.chats;
            totalInputTokens += s.tokens.input;
            totalOutputTokens += s.tokens.output;
            totalCalls += s.calls;
            totalCost += s.estimatedCostUsd;
            totalCreated += s.entities.created;
            totalSkillRuns += s.skills?.runs ?? 0;
            totalSkillErrors += s.skills?.errors ?? 0;
        }
        // Use latest snapshot for current entity state
        const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
        const totalDays = snapshots.length || 1;
        return {
            periodStart: dates[0] ?? today(),
            periodEnd: dates[dates.length - 1] ?? today(),
            totalDays: snapshots.length,
            totalChats,
            totalTokens: totalInputTokens + totalOutputTokens,
            totalInputTokens,
            totalOutputTokens,
            totalCalls,
            totalEstimatedCostUsd: Math.round(totalCost * 100) / 100,
            totalEntitiesCreated: totalCreated,
            currentEntityCount: latest?.entities.total ?? 0,
            currentEntityBreakdown: latest?.entities.byType ?? {},
            averageChatsPerDay: Math.round((totalChats / totalDays) * 100) / 100,
            averageTokensPerDay: Math.round(((totalInputTokens + totalOutputTokens) / totalDays)),
            averageCostPerDay: Math.round((totalCost / totalDays) * 100) / 100,
            totalSkillRuns,
            totalSkillErrors,
            dailySnapshots: snapshots,
        };
    }
    /** Get pricing table for reference. */
    getModelPricing() {
        return { ...MODEL_PRICING };
    }
}
// ── Singleton ────────────────────────────────────────────────────────────────
let _instance = null;
export function getAnalyticsService() {
    if (!_instance)
        _instance = new AnalyticsService();
    return _instance;
}
