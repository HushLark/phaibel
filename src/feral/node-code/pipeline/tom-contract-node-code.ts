// ─────────────────────────────────────────────────────────────────────────────
// Take on Me — Contract NodeCode
// ─────────────────────────────────────────────────────────────────────────────
//
// Decomposes the user's request into a CONTRACT: a checklist of concrete,
// independently-verifiable outcomes. The contract is the flow's completion
// spec — tom_flow_loop assembles one small Feral fragment per outstanding
// item and verifies each item against execution evidence, so multi-part
// requests can't silently end half-done (the measured failure mode of
// one-shot process design).
//
// Reads:  user_input, __history, __gathered_context_str, __reason_model_name
// Writes: __tom_contract  — Array<{ id, outcome, expect }>
//   expect: 'create:<entityType>' | 'update:<entityType>' | 'answer' | 'action'
// Result: ok | error
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { getModelForCapability } from '../../../llm/router.js';
import { parseJsonResponse } from '../../../utils/json-parser.js';
import { debug } from '../../../utils/debug.js';
import { formatHistoryBlock } from '../../../commands/chat-helpers.js';
import type { ChatHistoryEntry } from '../../../commands/chat-helpers.js';

export interface TomContractItem {
    id: string;
    /** Concrete outcome, phrased as a checkable statement. */
    outcome: string;
    /** Evidence class: create:<type> | update:<type> | answer | action */
    expect: string;
}

export class TomContractNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK,    description: 'Contract extracted; items in __tom_contract.' },
        { status: ResultStatus.ERROR, description: 'Contract extraction failed.' },
    ];

    constructor() {
        super(
            'tom_contract',
            'TOM: Contract',
            'Decomposes the request into a checklist of verifiable outcomes that the flow loop must satisfy.',
            'pipeline',
        );
    }

    async process(context: Context): Promise<Result> {
        const userInput = context.getString('user_input') ?? '';
        const history = (context.get('__history') as ChatHistoryEntry[] | null) ?? [];
        const gatheredStr = context.getString('__gathered_context_str') ?? '';
        const onStatus = context.get('__on_status') as ((s: string) => void) | null;

        onStatus?.('Planning the work…');

        try {
            const llm = await getModelForCapability('categorize');
            const raw = await llm.chat(
                [{
                    role: 'user' as const,
                    content: `The user said: "${userInput}"
${formatHistoryBlock(history)}
${gatheredStr ? `CONTEXT ALREADY GATHERED:\n${gatheredStr.slice(0, 1500)}\n` : ''}
Break this request into its distinct outcomes — the concrete things that must be TRUE afterward for the request to be fully satisfied. Rules:
- One item per distinct deliverable. "Create a task to fix the fence and a goal to improve the backyard" = 2 items. "Add a dentist appointment Tuesday 2pm" = 1 item.
- Ignore pleasantries and implementation details; capture user-visible outcomes only.
- "expect" classifies the evidence: "create:<entityType>" when a new entity of that type must exist, "update:<entityType>" when an existing one must change, "answer" when information must be provided in the reply, "action" for anything else (linking, searching, configuring).
- If the user asked to link/relate entities explicitly, that IS an item (expect "action").
- 1 to 6 items. Fewer, well-chosen items beat many trivial ones.

Return ONLY JSON: {"items":[{"id":"i1","outcome":"...","expect":"create:task"}]}`,
                }],
                {
                    systemPrompt: 'You extract completion contracts for a personal AI agent. Be precise about what the user explicitly asked for — no invented work, no dropped work.',
                    temperature: 0.1,
                    maxTokens: 800,
                },
            );
            const parsed = parseJsonResponse(raw) as { items?: TomContractItem[] } | null;
            const items = (parsed?.items ?? [])
                .filter(i => i && typeof i.outcome === 'string' && i.outcome.trim())
                .slice(0, 6)
                .map((i, idx) => ({ id: i.id || `i${idx + 1}`, outcome: i.outcome.trim(), expect: (i.expect || 'action').trim() }));

            if (items.length === 0) {
                // Degenerate contract — treat the whole request as one item so the
                // loop still runs (never block the flow on planner failure).
                items.push({ id: 'i1', outcome: userInput, expect: 'action' });
            }

            context.set('__tom_contract', items);
            debug('pipeline', `TOM contract: ${items.length} item(s) — ${items.map(i => `${i.id}:${i.expect}`).join(', ')}`);
            return this.result(ResultStatus.OK, `Contract extracted (${items.length} item(s)).`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            debug('pipeline', `TOM contract failed: ${msg}`);
            // Same degenerate fallback — the loop treats the raw input as one item.
            context.set('__tom_contract', [{ id: 'i1', outcome: userInput, expect: 'action' }]);
            return this.result(ResultStatus.OK, 'Contract extraction failed — using whole request as a single item.');
        }
    }
}
