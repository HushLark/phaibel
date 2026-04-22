// ─────────────────────────────────────────────────────────────────────────────
// Phaibel Analytics — Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

/** A single day's analytics snapshot. */
export interface DailySnapshot {
    date: string;                       // YYYY-MM-DD
    chats: number;                      // chat sessions started
    tokens: {
        input: number;
        output: number;
        total: number;
    };
    estimatedCostUsd: number;           // estimated USD cost from token usage
    calls: number;                      // total LLM API calls
    entities: {
        total: number;                  // total entity count at snapshot time
        byType: Record<string, number>; // per-type counts
        created: number;                // entities created today
    };
    skills?: {
        runs: number;                   // total skill executions today
        errors: number;                 // skill executions that failed
        bySkill: Record<string, { runs: number; errors: number }>; // per-skill counts
    };
}

/** Persistent analytics data file. */
export interface AnalyticsData {
    version: 1;
    days: Record<string, DailySnapshot>; // YYYY-MM-DD → snapshot
}

/** Summary over a date range. */
export interface AnalyticsSummary {
    periodStart: string;
    periodEnd: string;
    totalDays: number;
    totalChats: number;
    totalTokens: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCalls: number;
    totalEstimatedCostUsd: number;
    totalEntitiesCreated: number;
    currentEntityCount: number;
    currentEntityBreakdown: Record<string, number>;
    averageChatsPerDay: number;
    averageTokensPerDay: number;
    averageCostPerDay: number;
    dailySnapshots: DailySnapshot[];
    totalSkillRuns: number;
    totalSkillErrors: number;
}

/** Cost per million tokens by model. */
export interface ModelPricing {
    inputPerMillion: number;
    outputPerMillion: number;
}
