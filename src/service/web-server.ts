// ─────────────────────────────────────────────────────────────────────────────
// Web Server — HTTP + WebSocket for the Phaibel browser client
// ─────────────────────────────────────────────────────────────────────────────

import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { listEntities, writeEntity, parseEntity, getEntityDir } from '../entities/entity.js';
import { feralChatHeadless, type ChatHistoryEntry } from '../commands/chat.js';
import { appendReaction } from '../utils/chat-logger.js';
import { getQueueManager } from './queue/manager.js';
import { getEntityIndex } from '../entities/entity-index.js';
import { getVaultRoot, getAgentName } from '../state/manager.js';
import { getCronScheduler, loadCronConfig, saveCronConfig } from './cron/scheduler.js';
import { loadCalConfig } from '../commands/cal.js';
import { handleApiRoute } from './api-router.js';
import { debug } from '../utils/debug.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class WebServer {
    private server: http.Server | null = null;
    private wss: WebSocketServer | null = null;
    private htmlContent: string = '';

    async start(port: number): Promise<void> {
        // Load HTML at startup
        this.htmlContent = await fs.readFile(
            path.join(__dirname, 'web-client.html'),
            'utf-8',
        );

        this.server = http.createServer(async (req, res) => {
            try {
                await this.handleHttp(req, res);
            } catch (err) {
                debug('web', `HTTP error: ${err}`);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal server error' }));
            }
        });

        this.wss = new WebSocketServer({ server: this.server });
        this.wss.on('connection', (ws) => this.handleWs(ws));

        return new Promise((resolve, reject) => {
            this.server!.on('error', reject);
            this.server!.listen(port, () => resolve());
        });
    }

    async stop(): Promise<void> {
        if (this.wss) {
            for (const client of this.wss.clients) {
                client.close();
            }
            this.wss.close();
            this.wss = null;
        }

        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    this.server = null;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    /** Broadcast a refresh message to all connected clients. */
    broadcast(panel: 'today' | 'calendar'): void {
        if (!this.wss) return;
        const msg = JSON.stringify({ type: 'refresh', panel });
        for (const client of this.wss.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(msg);
            }
        }
    }

    // ── HTTP ─────────────────────────────────────────────────────────────

    private async handleHttp(
        req: http.IncomingMessage,
        res: http.ServerResponse,
    ): Promise<void> {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);

        if (req.method === 'GET' && url.pathname === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.htmlContent);
            return;
        }

        // ── REST API (entities, types, search, processes) ────────────
        if (url.pathname.startsWith('/api/types') ||
            url.pathname.startsWith('/api/entities') ||
            url.pathname.startsWith('/api/search') ||
            url.pathname.startsWith('/api/processes') ||
            url.pathname === '/api/calendar') {
            const handled = await handleApiRoute(req, res, url);
            if (handled) return;
        }

        // ── Convenience endpoints ─────────────────────────────────────

        if (req.method === 'GET' && url.pathname === '/api/calendars') {
            const cfg = await loadCalConfig();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(cfg.calendars.map(c => ({ id: c.id, name: c.name }))));
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/today') {
            const tasks = await this.getTodayTasks();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(tasks));
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/events') {
            const days = parseInt(url.searchParams.get('days') || '3', 10);
            const events = await this.getEvents(days);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(events));
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/scheduler') {
            const status = getCronScheduler().getStatus();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(status));
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/status') {
            const status = await this.getStatus();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(status));
            return;
        }

        // POST /api/scheduler/:job/toggle — enable or disable a job
        const toggleMatch = url.pathname.match(/^\/api\/scheduler\/([^/]+)\/toggle$/);
        if (req.method === 'POST' && toggleMatch) {
            const jobName = decodeURIComponent(toggleMatch[1]);
            const config = await loadCronConfig();
            const job = config.jobs[jobName];
            if (!job) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `Unknown job: ${jobName}` }));
                return;
            }
            job.enabled = !job.enabled;
            await saveCronConfig(config);
            await getCronScheduler().reload();
            const status = getCronScheduler().getStatus();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(status));
            return;
        }

        // POST /api/scheduler/:job/run — trigger a job immediately
        const runMatch = url.pathname.match(/^\/api\/scheduler\/([^/]+)\/run$/);
        if (req.method === 'POST' && runMatch) {
            const jobName = decodeURIComponent(runMatch[1]);
            try {
                const summary = await getCronScheduler().runJob(jobName);
                const status = getCronScheduler().getStatus();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ summary, ...status }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
            }
            return;
        }

        // PATCH /api/tasks/:id/done
        const taskDoneMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/done$/);
        if (req.method === 'PATCH' && taskDoneMatch) {
            const taskId = decodeURIComponent(taskDoneMatch[1]);
            const result = await this.markTaskDone(taskId);
            if (result.ok) {
                this.broadcast('today');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: result.error }));
            }
            return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    }

    // ── WebSocket ────────────────────────────────────────────────────────

    private handleWs(ws: WebSocket): void {
        debug('web', 'WebSocket client connected');

        let pendingAnswer: { resolve: (answer: string) => void } | null = null;
        const chatHistory: ChatHistoryEntry[] = [];

        ws.on('message', async (data) => {
            let msg: { type: string; message?: string; answer?: string; chatId?: string; reaction?: string; details?: string };
            try {
                msg = JSON.parse(data.toString());
            } catch {
                ws.send(JSON.stringify({ type: 'chat.error', error: 'Invalid JSON' }));
                return;
            }

            if (msg.type === 'chat.answer' && msg.answer !== undefined) {
                if (pendingAnswer) {
                    pendingAnswer.resolve(msg.answer);
                    pendingAnswer = null;
                }
                return;
            }

            if (msg.type === 'chat.reaction') {
                if (msg.chatId && (msg.reaction === 'positive' || msg.reaction === 'negative')) {
                    try {
                        await appendReaction(msg.chatId, msg.reaction, msg.details);
                        debug('web', `Reaction logged: ${msg.reaction} for ${msg.chatId}`);
                    } catch (err) {
                        debug('web', `Failed to log reaction: ${err}`);
                    }
                }
                return;
            }

            if (msg.type === 'chat' && msg.message) {
                const onQuestion = (question: string, options?: string[]): Promise<string> => {
                    return new Promise((resolve) => {
                        pendingAnswer = { resolve };
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: 'chat.question', question, options }));
                        }
                    });
                };
                await this.handleChat(ws, msg.message, onQuestion, chatHistory);
            }
        });

        ws.on('close', () => {
            debug('web', 'WebSocket client disconnected');
        });
    }

    private async handleChat(
        ws: WebSocket,
        message: string,
        onQuestion?: (question: string, options?: string[]) => Promise<string>,
        chatHistory?: ChatHistoryEntry[],
    ): Promise<void> {
        let currentChatId: string | undefined;
        try {
            const response = await feralChatHeadless(
                message,
                (status) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'chat.thinking', status }));
                    }
                },
                (processJson) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'chat.process', process: processJson }));
                    }
                },
                onQuestion,
                (chatId) => {
                    currentChatId = chatId;
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'chat.start', chatId }));
                    }
                },
                chatHistory,
            );

            // Track conversation history (last 3 exchanges)
            if (chatHistory) {
                chatHistory.push({ role: 'user', content: message });
                chatHistory.push({ role: 'assistant', content: response });
                while (chatHistory.length > 6) chatHistory.splice(0, 2);
            }

            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'chat.response', message: response, chatId: currentChatId }));
            }

            // If the chat likely mutated entities, tell clients to refresh
            const mutationKeywords = /creat|add|delet|remov|updat|done|complet|set |sync|import|mov|schedul/i;
            if (mutationKeywords.test(message)) {
                this.broadcast('today');
                this.broadcast('calendar');
            }
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            debug('web', `Chat error: ${error}`);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'chat.error', error, chatId: currentChatId }));
            }
        }
    }

    // ── Data helpers ─────────────────────────────────────────────────────

    private async getTodayTasks(): Promise<{ date: string; tasks: unknown[] }> {
        const today = new Date().toISOString().split('T')[0];
        try {
            const entities = await listEntities('task');
            const tasks = entities
                .filter((e) => {
                    if (e.meta.status === 'done') return false;
                    const due = e.meta.dueDate as string | undefined;
                    // Include if no due date, due today, or overdue
                    return !due || due <= today;
                })
                .map((e) => ({
                    id: e.meta.id,
                    title: e.meta.title,
                    status: e.meta.status || 'open',
                    priority: e.meta.priority || 'medium',
                    dueDate: e.meta.dueDate || null,
                }));
            return { date: today, tasks };
        } catch {
            return { date: today, tasks: [] };
        }
    }

    private async getEvents(days: number): Promise<{ dates: Record<string, unknown[]> }> {
        const now = new Date();
        const dates: Record<string, unknown[]> = {};

        // Initialize date buckets
        for (let i = 0; i < days; i++) {
            const d = new Date(now);
            d.setDate(d.getDate() + i);
            dates[d.toISOString().split('T')[0]] = [];
        }

        const dateKeys = Object.keys(dates);
        const startDate = dateKeys[0];
        const endDate = dateKeys[dateKeys.length - 1];

        try {
            const entities = await listEntities('event');
            for (const e of entities) {
                const eventDate = ((e.meta.startDate as string) || '').split('T')[0];
                if (eventDate >= startDate && eventDate <= endDate && dates[eventDate]) {
                    dates[eventDate].push({
                        title: e.meta.title,
                        startDate: e.meta.startDate,
                        endDate: e.meta.endDate,
                        location: e.meta.location || null,
                    });
                }
            }
        } catch {
            // No events directory or no active project
        }

        return { dates };
    }

    private async getStatus(): Promise<Record<string, unknown>> {
        const mem = process.memoryUsage();
        let queueSize = 0;
        try {
            const qm = await getQueueManager();
            queueSize = qm.size();
        } catch {
            // Queue not available
        }

        let graphNodes = 0;
        let graphEdges = 0;
        try {
            const stats = getEntityIndex().getStats();
            graphNodes = stats.nodeCount;
            graphEdges = stats.edgeCount;
        } catch {
            // Index not built yet
        }

        let vaultRoot = '';
        try {
            vaultRoot = await getVaultRoot();
        } catch {
            // No vault
        }

        let agentName = 'Agent';
        try {
            agentName = await getAgentName();
        } catch {
            // default
        }

        return {
            uptime: Math.round(process.uptime()),
            queueSize,
            graph: { nodes: graphNodes, edges: graphEdges },
            vaultRoot,
            agentName,
            memory: {
                rss: Math.round(mem.rss / 1024 / 1024),
                heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
            },
        };
    }

    private async markTaskDone(taskId: string): Promise<{ ok: boolean; error?: string }> {
        try {
            const dir = await getEntityDir('task');
            const files = await fs.readdir(dir);
            for (const file of files) {
                if (!file.endsWith('.md') || file.startsWith('.')) continue;
                const filepath = path.join(dir, file);
                const raw = await fs.readFile(filepath, 'utf-8');
                const { meta, content } = parseEntity(filepath, raw);
                if (meta.id === taskId) {
                    meta.status = 'done';
                    await writeEntity(filepath, meta, content);
                    return { ok: true };
                }
            }
            return { ok: false, error: 'Task not found' };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    }

    private readBody(req: http.IncomingMessage): Promise<string> {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            req.on('end', () => resolve(body));
            req.on('error', reject);
        });
    }
}
