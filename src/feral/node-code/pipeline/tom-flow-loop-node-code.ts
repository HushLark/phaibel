// ─────────────────────────────────────────────────────────────────────────────
// Take on Me — Flow Loop NodeCode
// ─────────────────────────────────────────────────────────────────────────────
//
// Contract-driven incremental flow assembly. For each outstanding contract
// item, the reason model designs a SMALL Feral fragment (a 2–6 node flow
// scoped to that single outcome) with full sight of all prior results; the
// engine executes it immediately. After the first pass, completion is checked
// DETERMINISTICALLY against execution evidence (created_entities et al.) —
// items with no evidence get exactly one repair fragment. Bounded everywhere:
// ≤ MAX_FRAGMENTS designs, ≤ 1 repair round, fingerprint dedupe.
//
// Why: one-shot whole-process design drops parts of multi-part requests
// (measured: smoke/multi-entity completeness ~50%), and whole-process
// re-design loops compound errors (measured: Cruel Summer/Hertz). Small
// fragments keep design accuracy high; the contract makes omissions visible
// and cheaply repairable. Every action is still a Feral flow — fragments are
// stitched and persisted so the artifact of a chat remains a reusable process.
//
// Reads: user_input, __history, __tom_contract, __gathered_context_str,
//        __selected_node_details, __node_code_details, __on_status,
//        __on_process, __process_engine, __reason_model_name
// Writes: __all_results, __all_reasonings, __nodes_used, __process_source,
//         __process_key
// Result: ok | error
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import type { ProcessEngine } from '../../engine/process-engine.js';
import type { CatalogNode } from '../../catalog/catalog-node.js';
import { hydrateProcess } from '../../process/process-json-hydrator.js';
import { getModelForCapability } from '../../../llm/router.js';
import { parseJsonResponse } from '../../../utils/json-parser.js';
import { debug } from '../../../utils/debug.js';
import {
    EXAMPLE_PROCESSES,
    formatHistoryBlock,
    compactResultsForPrompt,
    scrubSecrets,
} from '../../../commands/chat-helpers.js';
import type { ChatHistoryEntry } from '../../../commands/chat-helpers.js';
import type { TomContractItem } from './tom-contract-node-code.js';

const MAX_FRAGMENTS = 8;          // total design calls, incl. repairs
const MAX_REPAIR_ROUNDS = 1;

interface CreatedEntity { id?: string; title?: string; entityType?: string }

export class TomFlowLoopNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK,    description: 'Flow loop completed; results in __all_results.' },
        { status: ResultStatus.ERROR, description: 'Flow loop could not execute any fragment.' },
    ];

    constructor() {
        super(
            'tom_flow_loop',
            'TOM: Flow Loop',
            'Contract-driven flow assembly: one small Feral fragment per outstanding contract item, executed immediately, verified against evidence, one bounded repair round.',
            'pipeline',
        );
    }

    async process(context: Context): Promise<Result> {
        const userInput = context.getString('user_input') ?? '';
        const history = (context.get('__history') as ChatHistoryEntry[] | null) ?? [];
        const onStatus = context.get('__on_status') as ((s: string) => void) | null;
        const onProcess = context.get('__on_process') as ((p: Record<string, unknown>) => void) | null;
        const engine = context.get('__process_engine') as ProcessEngine | null;
        const reasonModelName = (context.getString('__reason_model_name') ?? 'gpt-4o');
        const selectedNodeDetails = context.getString('__selected_node_details') ?? '';
        const nodeCodeDetails = context.getString('__node_code_details') ?? '';
        const gatheredContextStr = context.getString('__gathered_context_str') ?? '';
        const selectedNodes = (context.get('__selected_nodes') as CatalogNode[] | null) ?? [];
        const contract = (context.get('__tom_contract') as TomContractItem[] | null)
            ?? [{ id: 'i1', outcome: userInput, expect: 'action' }];

        if (!engine) {
            return this.result(ResultStatus.ERROR, 'tom_flow_loop requires __process_engine in context.');
        }

        context.set('__process_source', 'custom');
        context.set('__process_key', 'chat.generated');

        const historyBlock = formatHistoryBlock(history);
        const examplesStr = EXAMPLE_PROCESSES.slice(0, 2).map((ex, i) =>
            `Example ${i + 1}: ${ex.description}\n${JSON.stringify(ex.json, null, 2)}`
        ).join('\n\n');

        const allResults: Record<string, unknown>[] = [];
        const allReasonings: string[] = [];
        const seenFingerprints = new Set<string>();
        const done = new Map<string, boolean>(contract.map(i => [i.id, false]));
        let designs = 0;

        const runFragment = async (item: TomContractItem, repairNote?: string): Promise<void> => {
            designs++;
            onStatus?.(`Working on: ${item.outcome.slice(0, 60)}…`);

            const previousResultsStr = allResults.length > 0
                ? `\n\nRESULTS SO FAR (from earlier fragments — reference EXACT titles/ids from here):\n${compactResultsForPrompt(allResults, reasonModelName)}`
                : '';
            const otherItems = contract.filter(i => i.id !== item.id)
                .map(i => `- [${done.get(i.id) ? 'done' : 'pending'}] ${i.outcome}`).join('\n');

            let raw: string;
            try {
                const reasonLlm = await getModelForCapability('reason');
                raw = await reasonLlm.chat(
                    [{
                        role: 'user' as const,
                        content: `Build ONE SMALL Feral process fragment that accomplishes ONLY this outcome:
"${item.outcome}"${repairNote ? `\n\nPREVIOUS ATTEMPT DID NOT PRODUCE EVIDENCE OF COMPLETION. ${repairNote}` : ''}

The user's full request (for context only — do NOT do the other items here): "${userInput}"
${otherItems ? `Other items handled separately:\n${otherItems}\n` : ''}${historyBlock}${previousResultsStr}
${gatheredContextStr}

SELECTED CATALOG NODES (you must only use nodes from this list):
${selectedNodeDetails}

NODE CONFIGURATION DETAILS:
${nodeCodeDetails}

PROCESS FORMAT RULES:
1. schema_version=1, key="chat.generated". First node: key="start", catalog_node_key="start". Last node: key="done", catalog_node_key="stop", edges={}.
2. "edges" maps result statuses to next node key. Most nodes produce "ok" and "error". Use {context_key} for interpolation.
3. KEEP IT SMALL: 2-5 working nodes between start and done. This fragment covers ONE outcome only.
4. For entity creation, ALWAYS set entity_title and entity_body with concrete values.
5. create_* nodes ONLY accept: entity_type, entity_title, entity_body, extra_fields. To set fields (startDate, priority, etc.): put values in process "context" object, list field names in extra_fields.
6. DATE FORMAT: date→YYYY-MM-DD, datetime→ISO 8601 with timezone. Events ALWAYS need startDate in context+extra_fields; include duration (ISO 8601, e.g. "PT1H") or endDate. Default startDate to 09:00 if no time given.
7. CRITICAL: Match entity types precisely. event≠task. Use create_event for appointments/meetings, create_task for todos. Never substitute types.
8. When referencing existing entities, use EXACT titles from GATHERED CONTEXT or RESULTS SO FAR. Use valid enum values only.
9. Prefer ACTION over QUESTIONS. Use sensible defaults (today's date, "medium" priority). No prompt nodes unless unavoidable.
10. If create_content_type is in your node list and the outcome needs a new type, create the type FIRST, then the entity.

EXAMPLE PROCESSES (note the shape; yours should usually be smaller):
${examplesStr}

Return ONLY JSON: {"reasoning": "one short sentence", "process": { ... }}`,
                    }],
                    {
                        systemPrompt: 'Generate a valid, minimal Feral process JSON fragment for exactly one outcome. catalog_node_key values must match exactly. Prefer action over advice.',
                        temperature: 0.3,
                        maxTokens: 8192,
                    },
                );
            } catch (err) {
                debug('pipeline', `TOM fragment design failed for ${item.id}: ${err instanceof Error ? err.message : err}`);
                allResults.push({ _error: `Fragment design failed for "${item.outcome}"` });
                return;
            }

            let design: { reasoning?: string; process?: Record<string, unknown> };
            try {
                design = parseJsonResponse(raw) as { reasoning?: string; process?: Record<string, unknown> };
                if (!design?.process) throw new Error('no process in design');
            } catch (err) {
                debug('pipeline', `TOM fragment parse failed for ${item.id}: ${err instanceof Error ? err.message : err}`);
                allResults.push({ _error: `Fragment parse failed for "${item.outcome}"` });
                return;
            }

            const fingerprint = JSON.stringify(design.process);
            if (seenFingerprints.has(fingerprint)) {
                debug('pipeline', `TOM duplicate fragment for ${item.id} — skipping`);
                return;
            }
            seenFingerprints.add(fingerprint);
            allReasonings.push(design.reasoning || item.outcome);
            onProcess?.(design.process);

            onStatus?.(`Running: ${item.outcome.slice(0, 60)}…`);
            try {
                const inline = hydrateProcess(JSON.parse(fingerprint));
                engine.clearCache();
                await engine.process(inline, context);
                engine.clearCache();
            } catch (execErr) {
                debug('pipeline', `TOM fragment execution failed for ${item.id}: ${execErr instanceof Error ? execErr.message : execErr}`);
                engine.clearCache();
                allResults.push(scrubSecrets({ _error: execErr instanceof Error ? execErr.message : String(execErr) }) as Record<string, unknown>);
                return;
            }

            // Collect non-internal context as this fragment's result snapshot
            const snapshot: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(context.getAll())) {
                if (k.startsWith('_') || k.startsWith('__') || k === 'user_input') continue;
                snapshot[k] = typeof v === 'string' && v.length > 2000 ? v.slice(0, 2000) + '…' : v;
            }
            allResults.push(scrubSecrets(snapshot) as Record<string, unknown>);
        };

        // ── Evidence check: deterministic first, tiny LLM fallback ────────────
        const collectCreated = (): CreatedEntity[] => {
            const out: CreatedEntity[] = [];
            for (const r of allResults) {
                const arr = r.created_entities as CreatedEntity[] | undefined;
                if (Array.isArray(arr)) out.push(...arr);
            }
            return out;
        };

        const keywordOverlap = (a: string, b: string): boolean => {
            const stop = new Set(['the','a','an','to','for','and','or','of','in','on','at','my','this','that','with','create','add','new','make']);
            const toks = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2 && !stop.has(t)));
            const ta = toks(a), tb = toks(b);
            for (const t of ta) if (tb.has(t)) return true;
            return ta.size === 0 || tb.size === 0; // vacuous when no signal
        };

        const hasEvidence = (item: TomContractItem): boolean | 'unknown' => {
            const [kind, type] = item.expect.split(':');
            if (kind === 'create') {
                const created = collectCreated();
                return created.some(e =>
                    (!type || e.entityType === type) && keywordOverlap(item.outcome, e.title ?? ''),
                ) || created.some(e => !type || e.entityType === type) && created.length >= 1 && contract.length === 1;
            }
            if (kind === 'update' || kind === 'action' || kind === 'answer') {
                // Deterministic evidence is weaker here — defer to the LLM check.
                return 'unknown';
            }
            return 'unknown';
        };

        const llmCheckUnknowns = async (items: TomContractItem[]): Promise<Set<string>> => {
            // Returns the ids judged COMPLETE. Single cheap call for all unknowns.
            if (items.length === 0) return new Set();
            try {
                const categorizeLlm = await getModelForCapability('categorize');
                const raw = await categorizeLlm.chat(
                    [{
                        role: 'user' as const,
                        content: `The user asked: "${userInput}"

Checklist items to verify:
${items.map(i => `- ${i.id}: ${i.outcome}`).join('\n')}

Execution results:
${compactResultsForPrompt(allResults, reasonModelName)}

For each item, decide from the results whether it was accomplished. Err toward "done" for minor detail differences; only mark "missing" when the outcome clearly did not happen. Creating duplicates is worse than a slightly imperfect result.

Return ONLY JSON: {"done": ["i1"], "missing": ["i2"]}`,
                    }],
                    { temperature: 0.1, maxTokens: 300 },
                );
                const parsed = parseJsonResponse(raw) as { done?: string[] } | null;
                return new Set(parsed?.done ?? items.map(i => i.id)); // on parse failure, assume done (no duplicate risk)
            } catch {
                return new Set(items.map(i => i.id)); // check failure must not trigger repairs
            }
        };

        // ── Pass 1: one fragment per contract item ─────────────────────────────
        for (const item of contract) {
            if (designs >= MAX_FRAGMENTS) break;
            await runFragment(item);
        }

        // ── Verify + one repair round ──────────────────────────────────────────
        for (let round = 0; round < MAX_REPAIR_ROUNDS; round++) {
            const unknowns: TomContractItem[] = [];
            for (const item of contract) {
                const ev = hasEvidence(item);
                if (ev === true) done.set(item.id, true);
                else if (ev === 'unknown') unknowns.push(item);
            }
            const judgedDone = await llmCheckUnknowns(unknowns);
            for (const item of unknowns) if (judgedDone.has(item.id)) done.set(item.id, true);

            const missing = contract.filter(i => !done.get(i.id));
            if (missing.length === 0) break;

            debug('pipeline', `TOM repair round: ${missing.length} item(s) missing — ${missing.map(i => i.id).join(', ')}`);
            for (const item of missing) {
                if (designs >= MAX_FRAGMENTS) break;
                await runFragment(item, 'Check the results so far, fix what went wrong, and produce the outcome. Do NOT recreate entities that already exist in the results.');
            }
            // Final deterministic sweep so __all_reasonings reflects reality
            for (const item of missing) if (hasEvidence(item) === true) done.set(item.id, true);
        }

        if (allReasonings.length === 0) {
            return this.result(ResultStatus.ERROR, 'No fragment could be designed or executed.');
        }

        const nodesUsed = selectedNodes.filter(Boolean).map(n => `- ${n!.key}: ${n!.description || n!.name}`);
        context.set('__all_results', allResults);
        context.set('__all_reasonings', allReasonings);
        context.set('__nodes_used', nodesUsed);

        const doneCount = [...done.values()].filter(Boolean).length;
        return this.result(ResultStatus.OK, `Flow loop complete: ${doneCount}/${contract.length} contract item(s) evidenced, ${allReasonings.length} fragment(s).`);
    }
}
