// ─────────────────────────────────────────────────────────────────────────────
// Web Server — HTTP + WebSocket for the Phaibel browser client
// ─────────────────────────────────────────────────────────────────────────────

import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { WebSocketServer, WebSocket } from 'ws';
import { listEntities, writeEntity, parseEntity, getEntityDir } from '../entities/entity.js';
import { feralChatHeadless, type ChatHistoryEntry, type ChatResult } from '../commands/chat.js';
import { getQueueManager } from './queue/manager.js';
import { getEntityIndex } from '../entities/entity-index.js';
import { getVaultRoot, getAgentName, findVaultRoot, isInterviewComplete, saveProfile, loadState } from '../state/manager.js';
import { refreshSystemPromptCache } from '../llm/router.js';
import { getEffectiveConfig } from '../config.js';
import { LLM_CAPABILITIES } from '../schemas/index.js';
import { getCronScheduler, loadCronConfig, saveCronConfig } from './cron/scheduler.js';
import { loadCalConfig, saveCalConfig } from '../commands/cal.js';
import { serializeToCxf } from '../cxf/cxf-serializer.js';
import { recordSync, shouldIncludeTombstone } from '../cxf/cxf-sync-state.js';
import { loadSystems, addSystem, removeSystem } from '../cxf/cxf-systems.js';
import { handleApiRoute } from './api-router.js';
import { handleCxRoute } from '../cxms/cx-router.js';
import { handlePiRoute } from '../introspection/pi-router.js';
import { handleFccfRoute } from '../feral/fccf-router.js';
import { handleFcpRoute } from '../federation/fcp-server.js';
import { handleAnalyticsRoute } from '../analytics/analytics-router.js';
import { logAccess } from '../cxms/access-log.js';
import { debug } from '../utils/debug.js';
import { transcribeAudio } from '../llm/transcribe.js';
import { handleMcpRequest } from './mcp-server.js';
import { handleAgentCard, handleA2ARequest } from './a2a-server.js';
import { PERSONALITIES } from '../personalities.js';
import { initEntityTypes, loadEntityTypes } from '../entities/entity-type-config.js';
import { SYSTEM_DIR } from '../paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class WebServer {
    private server: http.Server | null = null;
    private wss: WebSocketServer | null = null;
    private htmlContent: string = '';
    private mobileHtmlContent: string = '';
    private productveHtmlContent: string = '';
    private assistantHtmlContent: string = '';

    async start(port: number): Promise<void> {
        // Load HTML at startup
        this.htmlContent = await fs.readFile(
            path.join(__dirname, 'web-client.html'),
            'utf-8',
        );
        try {
            this.mobileHtmlContent = await fs.readFile(
                path.join(__dirname, 'mobile-client.html'),
                'utf-8',
            );
        } catch { /* mobile client optional */ }
        try {
            this.productveHtmlContent = await fs.readFile(
                path.join(__dirname, 'productve.html'),
                'utf-8',
            );
        } catch { /* productve client optional */ }
        try {
            this.assistantHtmlContent = await fs.readFile(
                path.join(__dirname, 'Assistant.html'),
                'utf-8',
            );
        } catch { /* assistant client optional */ }

        this.server = http.createServer(async (req, res) => {
            const startTime = Date.now();
            try {
                await this.handleHttp(req, res);
            } catch (err) {
                debug('web', `HTTP error: ${err}`);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal server error' }));
            }
            // Non-blocking access log — fire and forget
            logAccess(req, res, startTime).catch(() => {});
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

    /**
     * Push a proactive message into the chat window of all connected clients.
     * Used by background processes (cron jobs, etc.) to surface
     * information without the user asking.
     */
    broadcastChat(message: string, category?: string, data?: unknown): void {
        if (!this.wss) return;
        const msg = JSON.stringify({ type: 'chat.proactive', message, category: category || 'info', data });
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

        if (req.method === 'GET' && url.pathname === '/mobile.html') {
            if (this.mobileHtmlContent) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(this.mobileHtmlContent);
            } else {
                res.writeHead(404);
                res.end('Mobile client not available');
            }
            return;
        }

        if (req.method === 'GET' && (url.pathname === '/productve.html' || url.pathname === '/productve')) {
            if (this.productveHtmlContent) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(this.productveHtmlContent);
            } else {
                res.writeHead(404);
                res.end('Productve client not available');
            }
            return;
        }

        if (req.method === 'GET' && (url.pathname === '/Assistant.html' || url.pathname === '/assistant')) {
            if (this.assistantHtmlContent) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(this.assistantHtmlContent);
            } else {
                res.writeHead(404);
                res.end('Assistant client not available');
            }
            return;
        }

        // ── A2A Agent Card ─────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/.well-known/agent.json') {
            handleAgentCard(req, res);
            return;
        }

        // ── A2A Protocol ──────────────────────────────────────────────
        if (url.pathname === '/a2a' && req.method === 'POST') {
            await handleA2ARequest(req, res);
            return;
        }

        // ── MCP Protocol (Streamable HTTP) ────────────────────────────
        if (url.pathname === '/mcp') {
            await handleMcpRequest(req, res);
            return;
        }

        // ── CxMS API (/cx/*) ──────────────────────────────────────────
        if (url.pathname.startsWith('/cx/')) {
            const handled = await handleCxRoute(req, res, url);
            if (handled) return;
        }

        // ── Phaibel Introspection API (/pi/*) ────────────────────────
        if (url.pathname.startsWith('/pi/')) {
            const handled = await handlePiRoute(req, res, url);
            if (handled) return;
        }

        // ── Analytics API (/analytics/*) ───────────────────────────
        if (url.pathname.startsWith('/analytics/')) {
            const handled = await handleAnalyticsRoute(req, res, url);
            if (handled) return;
        }

        // ── Feral CCF API (/fccf/*) ─────────────────────────────────
        if (url.pathname.startsWith('/fccf/')) {
            const handled = await handleFccfRoute(req, res, url);
            if (handled) return;
        }

        // ── Federated Context Protocol (/fcp/*) ──────────────────────
        if (url.pathname.startsWith('/fcp/')) {
            const handled = await handleFcpRoute(req, res, url);
            if (handled) return;
        }

        // ── Legacy REST API (deprecated — use /cx/* and /pi/*) ───────
        if (url.pathname.startsWith('/api/types') ||
            url.pathname.startsWith('/api/entities') ||
            url.pathname.startsWith('/api/search') ||
            url.pathname.startsWith('/api/processes') ||
            url.pathname === '/api/calendar') {
            res.setHeader('Deprecation', 'true');
            res.setHeader('Link', '</cx/>; rel="successor-version"');
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

        if (req.method === 'POST' && url.pathname === '/api/calendars') {
            try {
                const body = JSON.parse(await this.readBody(req)) as { name?: string; url?: string };
                if (!body.name || !body.url) { res.writeHead(400); res.end(JSON.stringify({ error: 'name and url required' })); return; }
                const cfg = await loadCalConfig();
                const id = body.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
                if (cfg.calendars.some(c => c.id === id)) { res.writeHead(409); res.end(JSON.stringify({ error: `Calendar "${body.name}" already exists` })); return; }
                cfg.calendars.push({ id, name: body.name, url: body.url });
                await saveCalConfig(cfg);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, id, name: body.name }));
            } catch (err) { res.writeHead(400); res.end(JSON.stringify({ error: String(err) })); }
            return;
        }

        const calDeleteMatch = url.pathname.match(/^\/api\/calendars\/([^/]+)$/);
        if (req.method === 'DELETE' && calDeleteMatch) {
            try {
                const id = decodeURIComponent(calDeleteMatch[1]);
                const cfg = await loadCalConfig();
                const idx = cfg.calendars.findIndex(c => c.id === id);
                if (idx === -1) { res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return; }
                cfg.calendars.splice(idx, 1);
                await saveCalConfig(cfg);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
            } catch (err) { res.writeHead(400); res.end(JSON.stringify({ error: String(err) })); }
            return;
        }

        // ── CXF export ────────────────────────────────────────────────

        if (req.method === 'GET' && url.pathname === '/api/cxf') {
            try {
                const since = url.searchParams.get('since');
                const consumer = url.searchParams.get('consumer');
                const typesParam = url.searchParams.get('types');
                const includeSchema = url.searchParams.get('include_schema') !== 'false';
                const includeGraph = url.searchParams.get('include_graph') !== 'false';
                const excludeArchived = url.searchParams.get('exclude_archived') === 'true';
                const tagsParam = url.searchParams.get('tags');
                const filterTags = tagsParam ? tagsParam.split(',').map(t => t.trim()).filter(Boolean) : [];
                const filterTypes = typesParam ? typesParam.split(',').map(t => t.trim()).filter(Boolean) : [];
                const sinceUnix = since ? parseInt(since, 10) : null;
                const sinceIso = sinceUnix ? new Date(sinceUnix * 1000).toISOString() : null;

                const idx = getEntityIndex();
                if (!idx.isBuilt) await idx.build();
                const [entityTypes, state] = await Promise.all([loadEntityTypes(), loadState()]);

                let nodes = idx.getNodes();

                if (filterTypes.length) nodes = nodes.filter(n => filterTypes.includes(n.type));
                if (sinceIso) nodes = nodes.filter(n => {
                    const upd = (n.meta.updated ?? n.meta.created) as string | undefined;
                    return upd ? upd >= sinceIso : true;
                });
                if (filterTags.length) nodes = nodes.filter(n => filterTags.every(t => n.tags.includes(t)));

                const exportTime = Math.floor(Date.now() / 1000);
                const vaultId = `vault-${(state.userName ?? 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '-')}-01`;

                const result = serializeToCxf(nodes, entityTypes, [], {
                    vaultId,
                    ownerName: state.userName ?? 'Unknown',
                    ownerEmail: state.personalCalUrl ? '' : 'unknown@cxf.local',
                    exportTime,
                    includeSchema,
                    includeGraph,
                    includeArchived: !excludeArchived,
                });

                if (consumer) await recordSync(consumer);

                res.writeHead(200, {
                    'Content-Type': 'text/cxf; charset=utf-8',
                    'X-CXF-Export-Time': String(exportTime),
                    'X-CXF-Entity-Count': String(result.entityCount),
                    'X-CXF-Schema-Count': String(result.schemaCount),
                });
                res.end(result.document);
            } catch (err) {
                res.writeHead(500); res.end(JSON.stringify({ error: String(err) }));
            }
            return;
        }

        // ── CXF systems registry ──────────────────────────────────────

        if (req.method === 'GET' && url.pathname === '/api/cxf/systems') {
            const systems = await loadSystems();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(systems));
            return;
        }

        if (req.method === 'POST' && url.pathname === '/api/cxf/systems') {
            try {
                const body = JSON.parse(await this.readBody(req)) as Record<string, unknown>;
                if (!body.id || !body.name || !body.url) {
                    res.writeHead(400); res.end(JSON.stringify({ error: 'id, name, and url required' })); return;
                }
                await addSystem({
                    id: String(body.id),
                    name: String(body.name),
                    url: String(body.url),
                    cxfPath: body.cxfPath ? String(body.cxfPath) : undefined,
                    mode: body.mode === 'readwrite' ? 'readwrite' : 'read',
                    enabled: body.enabled !== false,
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
            } catch (err) { res.writeHead(400); res.end(JSON.stringify({ error: String(err) })); }
            return;
        }

        const cxfSystemDeleteMatch = url.pathname.match(/^\/api\/cxf\/systems\/([^/]+)$/);
        if (req.method === 'DELETE' && cxfSystemDeleteMatch) {
            const id = decodeURIComponent(cxfSystemDeleteMatch[1]);
            const removed = await removeSystem(id);
            res.writeHead(removed ? 200 : 404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: removed }));
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

        // GET /api/personalities — personality options for onboarding
        if (req.method === 'GET' && url.pathname === '/api/personalities') {
            const list = Object.values(PERSONALITIES).map(p => ({
                id: p.id,
                label: p.label,
                description: p.description,
            }));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(list));
            return;
        }

        // POST /api/setup — onboarding: create vault + save profile
        if (req.method === 'POST' && url.pathname === '/api/setup') {
            try {
                const body = JSON.parse(await this.readBody(req));
                const result = await this.handleSetup(body);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
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

        // GET /api/profile — current user/agent profile from state
        if (req.method === 'GET' && url.pathname === '/api/profile') {
            try {
                const state = await loadState();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    userName: state.userName,
                    agentName: state.agentName,
                    personality: state.personality,
                    gender: state.gender,
                    honorific: state.honorific,
                }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
            }
            return;
        }

        // PATCH /api/profile — update user/agent profile fields
        if (req.method === 'PATCH' && url.pathname === '/api/profile') {
            try {
                const body = JSON.parse(await this.readBody(req));
                const state = await loadState();
                const updated = {
                    userName: body.userName ?? state.userName ?? '',
                    agentName: body.agentName ?? state.agentName,
                    personality: body.personality ?? state.personality,
                    honorific: body.honorific ?? state.honorific,
                    gender: body.gender ?? state.gender,
                };
                await saveProfile(updated);
                refreshSystemPromptCache().catch(() => {});
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, ...updated }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
            }
            return;
        }

        // GET /api/models — effective LLM model per capability
        if (req.method === 'GET' && url.pathname === '/api/models') {
            try {
                const effective = await getEffectiveConfig();
                const models = LLM_CAPABILITIES.map(cap => ({
                    capability: cap,
                    provider: effective[cap]?.provider ?? null,
                    model: effective[cap]?.model ?? null,
                }));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(models));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
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
            let msg: { type: string; message?: string; answer?: string; chatId?: string; reaction?: string; details?: string; audio?: string };
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

            // Transcribe audio and treat as a chat message
            if (msg.type === 'chat.audio' && msg.audio) {
                try {
                    const audioBuffer = Buffer.from(msg.audio, 'base64');
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'chat.thinking', status: 'Transcribing...' }));
                    }
                    const transcript = await transcribeAudio(audioBuffer);
                    if (!transcript || !transcript.trim()) {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: 'chat.transcript', text: '' }));
                        }
                        return;
                    }
                    // Send transcript back so client can display it
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'chat.transcript', text: transcript }));
                    }
                    // Process as a normal chat message
                    msg.type = 'chat';
                    msg.message = transcript;
                } catch (err) {
                    debug('web', `Transcription failed: ${err}`);
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'chat.error', error: 'Transcription failed. Check that an OpenAI API key is configured.' }));
                    }
                    return;
                }
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
            const { response, tokens } = await feralChatHeadless(
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
                ws.send(JSON.stringify({ type: 'chat.response', message: response, chatId: currentChatId, totalTokens: tokens.totalTokens }));
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

        let interviewComplete = false;
        try {
            interviewComplete = await isInterviewComplete();
        } catch {
            // No vault yet
        }

        const require = createRequire(import.meta.url);
        const pkg = require('../../package.json');

        return {
            version: pkg.version,
            uptime: Math.round(process.uptime()),
            queueSize,
            graph: { nodes: graphNodes, edges: graphEdges },
            vaultRoot,
            agentName,
            interviewComplete,
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

    private async handleSetup(body: {
        vaultPath?: string;
        personality: string;
        agentName: string;
        userName: string;
        gender: string;
        answers?: {
            location?: string;
            work?: string;
            workGoals?: string;
            relationships?: string;
            health?: string;
            growth?: string;
            struggles?: string;
            helpStyle?: string;
        };
        personalCalUrl?: string;
        workCalUrl?: string;
    }): Promise<{ ok: true; vaultRoot: string; agentName: string }> {
        const vaultPath = body.vaultPath || process.cwd();

        // 1. Create vault if it doesn't exist
        const vaultFilePath = path.join(vaultPath, '.vault.md');
        try {
            await fs.access(vaultFilePath);
            debug('setup', 'Vault already exists at ' + vaultPath);
        } catch {
            // Create vault
            const today = new Date().toISOString().split('T')[0];
            const vaultName = path.basename(vaultPath);
            const rootVaultFile = `---
title: "${vaultName} Vault"
created: ${today}
tags: [context, system, root]
---

# ${vaultName}

## Agent

This vault is managed by a Personal Digital Agent that helps you get organised and manage your time. The agent's personality and name are configured during the onboarding interview.

## Memory

This vault is the agent's memory. Content is stored as Markdown files with YAML frontmatter, organised by type (tasks, events, notes, goals, people, etc.). All content can be linked in a knowledge graph — content items are nodes, relationships are edges. The agent should proactively link related content and use these connections to give better advice.

## Rules

- All files use YAML frontmatter for structured metadata
- Prefer creating entities over giving advice — if the user describes something actionable, make it
- Link related content when the connection is clear (task → goal, person → event, etc.)
- Be concise in responses — the user values their time
- When presenting lists, keep them scannable
- Reference content by name so the user knows exactly what changed

## User Preferences

- Timezone: Local machine time
- Date format: YYYY-MM-DD
`;
            await fs.writeFile(vaultFilePath, rootVaultFile);
            await fs.mkdir(SYSTEM_DIR(), { recursive: true });
            await fs.mkdir(path.join(vaultPath, '.phaibel'), { recursive: true });

            // Set PHAIBEL_VAULT so subsequent calls find the vault
            process.env.PHAIBEL_VAULT = vaultPath;

            await initEntityTypes();

            const entityTypes = await loadEntityTypes();
            const folders = entityTypes.map(t => t.directory);
            if (!folders.includes('inbox')) folders.push('inbox');
            for (const folder of folders) {
                await fs.mkdir(path.join(vaultPath, folder), { recursive: true });
            }

            // Create .gitignore
            const gitignore = `.state.json\n.phaibel/\n.DS_Store\n`;
            try {
                await fs.access(path.join(vaultPath, '.gitignore'));
                await fs.appendFile(path.join(vaultPath, '.gitignore'), '\n' + gitignore);
            } catch {
                await fs.writeFile(path.join(vaultPath, '.gitignore'), gitignore);
            }

            debug('setup', 'Vault created at ' + vaultPath);
        }

        // Ensure env is set for state operations
        process.env.PHAIBEL_VAULT = vaultPath;

        // 2. Save profile
        await saveProfile({
            userName: body.userName,
            agentName: body.agentName,
            personality: body.personality as 'butler' | 'rockstar' | 'executive' | 'friend' | 'pip' | 'emm',
            gender: body.gender as 'male' | 'female' | 'other',
            workType: body.answers?.work || undefined,
            familySituation: body.answers?.relationships || undefined,
            cityLive: body.answers?.location || undefined,
            personalCalUrl: body.personalCalUrl || undefined,
            workCalUrl: body.workCalUrl || undefined,
        });

        // 3. Write "About You" block to .vault.md
        const aboutLines: string[] = [
            '<!-- 10Q:START -->',
            '## About You',
            '',
            `- name: ${body.userName}`,
            `- gender: ${body.gender}`,
        ];
        if (body.answers?.location) aboutLines.push(`- location: ${body.answers.location}`);
        if (body.answers?.work) aboutLines.push(`- work: ${body.answers.work}`);
        if (body.answers?.workGoals) aboutLines.push(`- goals: ${body.answers.workGoals}`);
        if (body.answers?.relationships) aboutLines.push(`- relationships: ${body.answers.relationships}`);
        if (body.answers?.health) aboutLines.push(`- health: ${body.answers.health}`);
        if (body.answers?.growth) aboutLines.push(`- growth: ${body.answers.growth}`);
        if (body.answers?.struggles) aboutLines.push(`- struggles: ${body.answers.struggles}`);
        if (body.answers?.helpStyle) aboutLines.push(`- help_style: ${body.answers.helpStyle}`);
        aboutLines.push('<!-- 10Q:END -->');

        const aboutBlock = aboutLines.join('\n');

        try {
            let content = await fs.readFile(vaultFilePath, 'utf-8');
            if (content.includes('<!-- 10Q:START -->')) {
                content = content.replace(/<!-- 10Q:START -->[\s\S]*?<!-- 10Q:END -->/, aboutBlock);
            } else {
                content = content.trimEnd() + '\n\n' + aboutBlock + '\n';
            }
            await fs.writeFile(vaultFilePath, content);
        } catch (err) {
            debug('setup', `Failed to write about block: ${err}`);
        }

        // 4. Auto-configure calendars
        if (body.personalCalUrl || body.workCalUrl) {
            try {
                const cfg = await loadCalConfig();
                if (body.personalCalUrl && !cfg.calendars.some((c: { id: string }) => c.id === 'personal')) {
                    cfg.calendars.push({ id: 'personal', name: 'Personal', url: body.personalCalUrl });
                }
                if (body.workCalUrl && !cfg.calendars.some((c: { id: string }) => c.id === 'work')) {
                    cfg.calendars.push({ id: 'work', name: 'Work', url: body.workCalUrl });
                }
                await saveCalConfig(cfg);
            } catch (err) {
                debug('setup', `Failed to configure calendars: ${err}`);
            }
        }

        return { ok: true, vaultRoot: vaultPath, agentName: body.agentName };
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

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON — allows background processes to push to the chat
// ─────────────────────────────────────────────────────────────────────────────

let _instance: WebServer | null = null;

export function setWebServerInstance(server: WebServer): void {
    _instance = server;
}

export function getWebServer(): WebServer | null {
    return _instance;
}

/**
 * Push a proactive message to all connected chat clients.
 * Safe to call even when no web server is running (no-ops silently).
 */
export function pushToChat(message: string, category?: string, data?: unknown): void {
    _instance?.broadcastChat(message, category, data);
}
