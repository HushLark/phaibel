// ─────────────────────────────────────────────────────────────────────────────
// World Model Synthesis — proactive intelligence about the user's world
//
// Periodically reads all entities, synthesizes them into a coherent model of
// the user's current state, and generates proactive insights/nudges. Results
// are stored in {vault}/.phaibel/world-model.json for the web client to display.
// Users grade each insight so the system learns what's useful over time.
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'fs';
import path from 'path';
import { findVaultRoot, getUserName, getAgentName } from '../../state/manager.js';
import { getVaultConfigDir } from '../../paths.js';
import { getModelForCapability } from '../../llm/router.js';
import { listEntities } from '../../entities/entity.js';
import { loadEntityTypes } from '../../entities/entity-type-config.js';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface Insight {
    id: string;
    category: 'reminder' | 'opportunity' | 'risk' | 'progress' | 'connection' | 'suggestion';
    title: string;
    body: string;
    priority: 'high' | 'medium' | 'low';
    relatedEntities: string[];  // "type:id" keys
    grade?: 'useful' | 'not_useful' | null;
    gradedAt?: string | null;
}

export interface WorldModel {
    synthesizedAt: string;
    userName: string;
    agentName: string;
    entityCounts: Record<string, number>;
    insights: Insight[];
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE I/O
// ─────────────────────────────────────────────────────────────────────────────

async function getWorldModelPath(): Promise<string> {
    const dir = await getVaultConfigDir();
    return path.join(dir, 'world-model.json');
}

export async function loadWorldModel(): Promise<WorldModel | null> {
    try {
        const raw = await fs.readFile(await getWorldModelPath(), 'utf-8');
        return JSON.parse(raw) as WorldModel;
    } catch {
        return null;
    }
}

export async function saveWorldModel(model: WorldModel): Promise<void> {
    const dir = await getVaultConfigDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(await getWorldModelPath(), JSON.stringify(model, null, 2));
}

export async function gradeInsight(insightId: string, grade: 'useful' | 'not_useful'): Promise<boolean> {
    const model = await loadWorldModel();
    if (!model) return false;

    const insight = model.insights.find(i => i.id === insightId);
    if (!insight) return false;

    insight.grade = grade;
    insight.gradedAt = new Date().toISOString();
    await saveWorldModel(model);
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// SYNTHESIS
// ─────────────────────────────────────────────────────────────────────────────

export async function synthesizeWorldModel(): Promise<string> {
    const vaultRoot = await findVaultRoot();
    if (!vaultRoot) return 'skipped (no vault)';

    const userName = await getUserName() || 'User';
    const agentName = await getAgentName() || 'Phaibel';
    const types = await loadEntityTypes();
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();

    // ── Gather all entities ──────────────────────────────────────────────
    const entityCounts: Record<string, number> = {};
    const summaries: string[] = [];

    for (const type of types) {
        try {
            const entities = await listEntities(type.name);
            entityCounts[type.name] = entities.length;

            if (entities.length === 0) continue;

            // Build a compact summary of each entity type
            const lines: string[] = [`## ${type.plural} (${entities.length})`];

            for (const e of entities.slice(0, 50)) { // cap at 50 per type
                const title = e.meta.title || '(untitled)';
                const status = e.meta.status || '';
                const dueDate = e.meta.dueDate || e.meta.startDate || '';
                const priority = e.meta.priority || '';
                const tags = Array.isArray(e.meta.tags) ? (e.meta.tags as string[]).join(', ') : '';

                const parts = [`- **${title}**`];
                if (status) parts.push(`[${status}]`);
                if (priority) parts.push(`(${priority})`);
                if (dueDate) parts.push(`due: ${dueDate}`);
                if (tags) parts.push(`tags: ${tags}`);

                // Include body snippet for context
                if (e.content.trim()) {
                    parts.push(`— ${e.content.trim().slice(0, 120)}`);
                }

                lines.push(parts.join(' '));
            }

            if (entities.length > 50) {
                lines.push(`- ... and ${entities.length - 50} more`);
            }

            summaries.push(lines.join('\n'));
        } catch {
            entityCounts[type.name] = 0;
        }
    }

    if (summaries.length === 0) {
        return 'skipped (no entities)';
    }

    // ── Load previous model and check capacity ─────────────────────────
    const MAX_INSIGHTS = 5;
    const previousModel = await loadWorldModel();
    const existingInsights = previousModel?.insights.filter(i => !i.grade) ?? [];
    const slotsAvailable = MAX_INSIGHTS - existingInsights.length;

    if (slotsAvailable <= 0) {
        return `skipped (${existingInsights.length} ungraded insights already at cap)`;
    }

    let gradeFeedback = '';
    if (previousModel?.insights.some(i => i.grade)) {
        const graded = previousModel.insights.filter(i => i.grade);
        const useful = graded.filter(i => i.grade === 'useful');
        const notUseful = graded.filter(i => i.grade === 'not_useful');
        gradeFeedback = `\n\nPREVIOUS INSIGHT FEEDBACK:
${useful.length} insights were graded "useful": ${useful.map(i => `"${i.title}" (${i.category})`).join(', ') || 'none'}
${notUseful.length} insights were graded "not useful": ${notUseful.map(i => `"${i.title}" (${i.category})`).join(', ') || 'none'}

Generate MORE insights like the useful ones and FEWER like the not-useful ones.`;
    }

    // ── Call LLM ─────────────────────────────────────────────────────────
    const llm = await getModelForCapability('reason');

    const prompt = `You are ${agentName}, a proactive personal assistant for ${userName}. Today is ${today}.

Analyze the following complete picture of ${userName}'s world — all their tasks, events, goals, people, notes, and other tracked items. Your job is to be PROACTIVE: surface things ${userName} should know, act on, or think about BEFORE they ask.

${summaries.join('\n\n')}
${gradeFeedback}

Generate exactly ${slotsAvailable} proactive insight${slotsAvailable === 1 ? '' : 's'}. Each insight should be something ${userName} would genuinely find valuable — not obvious observations, but connections, risks, opportunities, and timely nudges.

CATEGORIES:
- "reminder": Something time-sensitive that needs attention soon
- "opportunity": A chance to make progress or take advantage of timing
- "risk": Something that could go wrong if not addressed
- "progress": Positive momentum or milestone worth acknowledging
- "connection": A relationship between items ${userName} might not have noticed
- "suggestion": A proactive recommendation to improve their workflow or life

RULES:
- Be specific — reference actual entity titles and dates
- Be actionable — tell ${userName} what they could do, not just what you noticed
- Prioritize time-sensitive items (overdue tasks, upcoming events, approaching deadlines)
- Look for conflicts (double-booked events, competing deadlines)
- Notice stalled goals or forgotten tasks
- Spot opportunities to link people with events or tasks
- Keep each insight concise (1-3 sentences)

Respond with ONLY valid JSON (no markdown fences), matching this schema:
{
    "insights": [
        {
            "category": "reminder|opportunity|risk|progress|connection|suggestion",
            "title": "Short headline (under 60 chars)",
            "body": "1-3 sentence explanation with specific details",
            "priority": "high|medium|low",
            "relatedEntities": ["type:id", "type:id"]
        }
    ]
}`;

    const response = await llm.chat(
        [{ role: 'user' as const, content: prompt }],
        {
            systemPrompt: `You are a proactive personal intelligence engine. You analyze a person's complete set of commitments, goals, relationships, and plans to surface timely, actionable insights. Respond with ONLY valid JSON — no markdown, no explanation, no fences.`,
            temperature: 0.4,
        },
    );

    // ── Parse response ───────────────────────────────────────────────────
    let insights: Insight[];
    try {
        const cleaned = response.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(cleaned) as { insights: Array<Omit<Insight, 'id' | 'grade' | 'gradedAt'>> };

        insights = parsed.insights.map((raw, i) => ({
            id: `wm-${Date.now()}-${i}`,
            category: raw.category || 'suggestion',
            title: raw.title || 'Insight',
            body: raw.body || '',
            priority: raw.priority || 'medium',
            relatedEntities: raw.relatedEntities || [],
            grade: null,
            gradedAt: null,
        }));
    } catch (err) {
        console.error('[world-model] Failed to parse LLM response:', err);
        return 'error: failed to parse insights';
    }

    // ── Merge with existing insights ────────────────────────────────────
    // Keep existing ungraded insights + append new ones (cap at MAX_INSIGHTS)
    const mergedInsights = [...existingInsights, ...insights].slice(0, MAX_INSIGHTS);

    const model: WorldModel = {
        synthesizedAt: now.toISOString(),
        userName,
        agentName,
        entityCounts,
        insights: mergedInsights,
    };

    await saveWorldModel(model);

    // ── Push new insights to connected chat clients ──────────────────
    const { pushToChat } = await import('../web-server.js');
    if (insights.length > 0) {
        const lines = insights.map(i => {
            const icon = i.priority === 'high' ? '**' : '';
            return `- ${icon}${i.title}${icon}: ${i.body}`;
        });
        pushToChat(lines.join('\n'), 'insight');
    }

    const highCount = insights.filter(i => i.priority === 'high').length;
    return `${insights.length} insights generated (${highCount} high priority)`;
}
