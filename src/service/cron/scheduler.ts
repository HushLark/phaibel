// ─────────────────────────────────────────────────────────────────────────────
// CRON SCHEDULER
// Runs periodic background jobs inside the service daemon.
// Jobs execute directly (not through the queue) to avoid competing with
// user-submitted tasks for the 10-slot queue.
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'fs';
import { syncCalendar } from '../../commands/cal.js';
import { processInbox } from '../../commands/inbox.js';
import { generateRecurrences } from '../../commands/recurrence.js';
import { evaluateProcessLifecycle } from './process-lifecycle.js';
import { checkPampMail } from './pamp-checker.js';
import { getEntityIndex } from '../../entities/entity-index.js';
import { getEmbeddingIndex } from '../../entities/embedding-index.js';
import { analyzeFeedback } from './feedback-analysis.js';
import { runInnovation } from './innovate.js';
import { getCronConfigPath, getVaultConfigDir } from '../../paths.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

export interface CronJobConfig {
    enabled: boolean;
    intervalMinutes: number;
}

export interface CronConfig {
    jobs: Record<string, CronJobConfig>;
}

const DEFAULT_CONFIG: CronConfig = {
    jobs: {
        'cal-sync':            { enabled: false, intervalMinutes: 60 },
        'inbox-import':        { enabled: false, intervalMinutes: 30 },
        'recurrence-generate': { enabled: false, intervalMinutes: 1440 },
        'process-lifecycle':   { enabled: false, intervalMinutes: 60 },
        'pamp-check':          { enabled: false, intervalMinutes: 15 },
        'embedding-sync':      { enabled: true, intervalMinutes: 1440 },
        'feedback-analysis':   { enabled: false, intervalMinutes: 1440 },
        'innovate':            { enabled: false, intervalMinutes: 1440 },
    },
};

export async function loadCronConfig(): Promise<CronConfig> {
    try {
        const configPath = await getCronConfigPath();
        const raw = await fs.readFile(configPath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<CronConfig>;
        // Merge with defaults so new jobs are always present
        return {
            jobs: { ...DEFAULT_CONFIG.jobs, ...parsed.jobs },
        };
    } catch {
        return structuredClone(DEFAULT_CONFIG);
    }
}

export async function saveCronConfig(config: CronConfig): Promise<void> {
    const dir = await getVaultConfigDir();
    await fs.mkdir(dir, { recursive: true });
    const configPath = await getCronConfigPath();
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

interface CronJobDef {
    name: string;
    run: () => Promise<string>;  // returns a short summary
}

const JOB_DEFS: CronJobDef[] = [
    {
        name: 'cal-sync',
        async run() {
            const result = await syncCalendar();
            return `${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged`;
        },
    },
    {
        name: 'inbox-import',
        async run() {
            const result = await processInbox();
            return `${result.processed} processed, ${result.skipped} skipped`;
        },
    },
    {
        name: 'recurrence-generate',
        async run() {
            const result = await generateRecurrences();
            return `${result.created} created, ${result.skipped} skipped`;
        },
    },
    {
        name: 'process-lifecycle',
        async run() {
            return evaluateProcessLifecycle();
        },
    },
    {
        name: 'pamp-check',
        async run() {
            const result = await checkPampMail();
            if (result.skipped) return 'skipped (PAMP not configured)';
            return `${result.fetched} fetched, ${result.errors} errors`;
        },
    },
    {
        name: 'embedding-sync',
        async run() {
            const embeddingIndex = getEmbeddingIndex();
            if (!embeddingIndex.isLoaded) return 'skipped (not loaded)';
            const entityIndex = getEntityIndex();
            if (!entityIndex.isBuilt) return 'skipped (entity index not built)';
            const result = await embeddingIndex.sync(entityIndex);
            return `${result.added} added, ${result.updated} updated, ${result.removed} removed`;
        },
    },
    {
        name: 'feedback-analysis',
        async run() {
            return analyzeFeedback();
        },
    },
    {
        name: 'innovate',
        async run() {
            return runInnovation();
        },
    },
];

// ─────────────────────────────────────────────────────────────────────────────
// STATUS
// ─────────────────────────────────────────────────────────────────────────────

export interface CronJobStatus {
    name: string;
    enabled: boolean;
    intervalMinutes: number;
    running: boolean;
    lastRunAt: string | null;
    lastResult: string | null;
    lastError: string | null;
    nextRunAt: string | null;
}

export interface CronStatus {
    jobs: CronJobStatus[];
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULER
// ─────────────────────────────────────────────────────────────────────────────

interface RunningJob {
    timer: ReturnType<typeof setInterval>;
    running: boolean;
    lastRunAt: Date | null;
    lastResult: string | null;
    lastError: string | null;
    nextRunAt: Date | null;
}

export class CronScheduler {
    private jobs = new Map<string, RunningJob>();
    private config: CronConfig | null = null;

    async start(): Promise<void> {
        this.config = await loadCronConfig();

        for (const def of JOB_DEFS) {
            const jobConfig = this.config.jobs[def.name];
            if (!jobConfig?.enabled) continue;

            this.startJob(def, jobConfig);
        }

        const enabled = JOB_DEFS.filter(d => this.config!.jobs[d.name]?.enabled).length;
        if (enabled > 0) {
            console.log(`Cron scheduler: ${enabled} job(s) active`);
        }
    }

    stop(): void {
        for (const [, job] of this.jobs) {
            clearInterval(job.timer);
        }
        this.jobs.clear();
    }

    getStatus(): CronStatus {
        const config = this.config;
        if (!config) {
            return { jobs: [] };
        }

        return {
            jobs: JOB_DEFS.map(def => {
                const jobConfig = config.jobs[def.name];
                const running = this.jobs.get(def.name);
                return {
                    name: def.name,
                    enabled: jobConfig?.enabled ?? false,
                    intervalMinutes: jobConfig?.intervalMinutes ?? 0,
                    running: running?.running ?? false,
                    lastRunAt: running?.lastRunAt?.toISOString() ?? null,
                    lastResult: running?.lastResult ?? null,
                    lastError: running?.lastError ?? null,
                    nextRunAt: running?.nextRunAt?.toISOString() ?? null,
                };
            }),
        };
    }

    async runJob(name: string): Promise<string> {
        const def = JOB_DEFS.find(d => d.name === name);
        if (!def) {
            throw new Error(`Unknown cron job: ${name}`);
        }

        const state = this.jobs.get(name);
        if (state?.running) {
            throw new Error(`Job "${name}" is already running`);
        }

        return this.executeJob(def);
    }

    async reload(): Promise<void> {
        this.stop();
        await this.start();
    }

    private startJob(def: CronJobDef, jobConfig: CronJobConfig): void {
        const intervalMs = jobConfig.intervalMinutes * 60 * 1000;
        const now = new Date();

        const state: RunningJob = {
            timer: setInterval(() => this.tick(def), intervalMs),
            running: false,
            lastRunAt: null,
            lastResult: null,
            lastError: null,
            nextRunAt: new Date(now.getTime() + intervalMs),
        };

        this.jobs.set(def.name, state);
    }

    private async tick(def: CronJobDef): Promise<void> {
        const state = this.jobs.get(def.name);
        if (!state || state.running) return; // skip if still running

        await this.executeJob(def);
    }

    private async executeJob(def: CronJobDef): Promise<string> {
        let state = this.jobs.get(def.name);
        if (!state) {
            // Job triggered via `runJob` but not scheduled — create temp state
            state = {
                timer: null as unknown as ReturnType<typeof setInterval>,
                running: false,
                lastRunAt: null,
                lastResult: null,
                lastError: null,
                nextRunAt: null,
            };
            this.jobs.set(def.name, state);
        }

        state.running = true;
        const startTime = new Date();

        try {
            const result = await def.run();
            state.lastRunAt = startTime;
            state.lastResult = result;
            state.lastError = null;
            console.log(`[cron] ${def.name}: ${result}`);
            return result;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            state.lastRunAt = startTime;
            state.lastError = msg;
            console.error(`[cron] ${def.name} error: ${msg}`);
            throw err;
        } finally {
            state.running = false;
            // Update nextRunAt
            const jobConfig = this.config?.jobs[def.name];
            if (jobConfig?.enabled) {
                state.nextRunAt = new Date(Date.now() + jobConfig.intervalMinutes * 60 * 1000);
            }
        }
    }
}

// Singleton
let scheduler: CronScheduler | null = null;

export function getCronScheduler(): CronScheduler {
    if (!scheduler) {
        scheduler = new CronScheduler();
    }
    return scheduler;
}
