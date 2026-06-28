// ─────────────────────────────────────────────────────────────────────────────
// Pipeline NodeCode — Synthesize Response (Phase 8)
// ─────────────────────────────────────────────────────────────────────────────
//
// Final step: asks the chat LLM to compose a natural-language response from the
// accumulated process results, then stores it in __pipeline_response.
//
// Reads: user_input, __history, __vault_context, __all_results, __all_reasonings,
//        __nodes_used, __chat_id, __client_hints, __reason_model_name, __on_status
// Writes: __pipeline_response
// Result: ok (always — errors are surfaced in the response text)
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { getModelForCapability } from '../../../llm/router.js';
import { debug } from '../../../utils/debug.js';
import { synthesizeResponse } from '../../../commands/chat-helpers.js';
import type { ChatHistoryEntry, ClientHints } from '../../../commands/chat-helpers.js';
import { getSourceNames } from '../../../cfx3/source-registry.js';
import type { GatheredContext } from '../../../context/context-loop.js';

export class PipelineSynthesizeNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Response synthesised; stored in __pipeline_response.' },
    ];

    constructor() {
        super(
            'pipeline_synthesize',
            'Pipeline: Synthesize',
            'Composes the final natural-language response from accumulated results (Phase 8).',
            'pipeline',
        );
    }

    async process(context: Context): Promise<Result> {
        const userInput = context.getString('user_input') ?? '';
        const history = (context.get('__history') as ChatHistoryEntry[] | null) ?? [];
        const vaultContext = (context.getString('__vault_context') ?? '');
        const allResults = (context.get('__all_results') as Record<string, unknown>[] | null) ?? [];
        const allReasonings = (context.get('__all_reasonings') as string[] | null) ?? [];
        const nodesUsed = (context.get('__nodes_used') as string[] | null) ?? [];
        const chatId = context.getString('__chat_id') ?? undefined;
        const clientHints = context.get('__client_hints') as ClientHints | null ?? undefined;
        const reasonModelName = context.getString('__reason_model_name') ?? 'gpt-4o';
        const onStatus = context.get('__on_status') as ((s: string) => void) | null;
        const sourceScope = context.get('__source_scope') as { id: string; name: string } | null;

        onStatus?.('Composing response…');

        const reasoning = allReasonings.length > 0 ? allReasonings.join(' → ') : 'No reasoning recorded.';

        // If the pipeline was blocked and planted the response directly, return it
        const presetResponse = context.getString('__pipeline_response');
        if (presetResponse) {
            return this.result(ResultStatus.OK, 'Response was pre-set by classify node.');
        }

        // Build a federated-provenance block so the answer can cite its source
        // ("<connection> has …") for any node that came from a CF/x3 connection.
        let federatedContext = '';
        try {
            const gathered = context.get('__gathered_context') as GatheredContext | null;
            const federated = (gathered?.nodes ?? []).filter(n => typeof n.meta.source === 'string' && n.meta.source);
            if (federated.length > 0) {
                const names = await getSourceNames();
                const lines = federated.slice(0, 30).map(n => {
                    const src = String(n.meta.source);
                    return `- "${n.name}" (${n.type}) — from ${names.get(src) ?? src}`;
                });
                federatedContext = lines.join('\n');
            }
        } catch { /* attribution is best-effort */ }

        try {
            const chatLlm = await getModelForCapability('chat');
            const response = await synthesizeResponse(
                chatLlm,
                userInput,
                reasoning,
                allResults,
                nodesUsed,
                vaultContext,
                history,
                chatId,
                clientHints,
                reasonModelName,
                sourceScope?.name,
                federatedContext || undefined,
            );
            context.set('__pipeline_response', response);
            debug('pipeline', `Synthesis complete (${response.length} chars)`);
            return this.result(ResultStatus.OK, 'Response synthesised.');
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            debug('pipeline', `Synthesis failed: ${msg}`);
            context.set('__pipeline_response', `Something went wrong composing a response: ${msg}`);
            return this.result(ResultStatus.OK, `Synthesis failed — error message set as response.`);
        }
    }
}
