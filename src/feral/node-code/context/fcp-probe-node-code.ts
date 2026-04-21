// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — FCP Probe NodeCode
//
// Fans out a probe request to all configured FCP sources.
// Supports four modes: keyword, date, todo, latest.
// Stores the FederatedRelevance result in context for fcp_fetch to consume.
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { probeAll, probeByDate, probeTodos, probeLatest } from '../../../federation/federator.js';
import { extractKeywords } from '../../../context/query-relevance.js';

export class FcpProbeNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'mode', name: 'Mode', description: 'Probe mode: keyword (default), date, todo, or latest.', type: 'string', isOptional: true },
        { key: 'keywords', name: 'Keywords', description: 'Space-separated keywords for mode=keyword. Falls back to user_input if omitted.', type: 'string', isOptional: true },
        { key: 'date', name: 'Date', description: 'ISO-8601 date for mode=date (e.g. 2026-04-20). Falls back to context "date" key.', type: 'string', isOptional: true },
        { key: 'date_to', name: 'Date To', description: 'End of range for mode=date. Defaults to same as date (single day).', type: 'string', isOptional: true },
        { key: 'entity_types', name: 'Entity Types', description: 'Comma-separated entity types to hint (e.g. task,event). Optional.', type: 'string', isOptional: true },
        { key: 'limit', name: 'Limit', description: 'Max results per source for mode=latest. Default 10.', type: 'string', isOptional: true },
        { key: 'context_path', name: 'Context Path', description: 'Where to store the probe result. Default: fcp_probe.', type: 'string', isOptional: true },
    ];

    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'At least one source returned matches.' },
        { status: 'no_results', description: 'No sources returned matches.' },
        { status: ResultStatus.ERROR, description: 'Probe failed.' },
    ];

    constructor() {
        super('fcp_probe', 'FCP Probe', 'Fan-out a context probe to all configured FCP sources. Returns summary titles and IDs for follow-up fetch.', NodeCodeCategory.DATA);
    }

    async process(context: Context): Promise<Result> {
        const mode = (this.getOptionalConfigValue('mode') as string | null) ?? 'keyword';
        const contextPath = (this.getOptionalConfigValue('context_path') as string | null) ?? 'fcp_probe';

        const entityTypesRaw = this.getOptionalConfigValue('entity_types') as string | null;
        const entityTypes = entityTypesRaw ? entityTypesRaw.split(',').map(s => s.trim()).filter(Boolean) : undefined;

        try {
            let result;

            if (mode === 'date') {
                const dateVal = this.resolveDate(context);
                if (!dateVal) {
                    context.set('error', 'mode=date requires a date value (config "date" or context "date").');
                    return this.result(ResultStatus.ERROR, 'Missing date for date probe.');
                }
                const dateTo = (this.getOptionalConfigValue('date_to') as string | null) ?? dateVal;
                result = await probeByDate(dateVal, { dateTo, entityTypes });

            } else if (mode === 'todo') {
                result = await probeTodos();

            } else if (mode === 'latest') {
                const limitRaw = this.getOptionalConfigValue('limit') as string | null;
                const limit = limitRaw ? parseInt(limitRaw, 10) : 10;
                result = await probeLatest({ entityTypes, limit });

            } else {
                // keyword mode
                const keywordsRaw = this.getOptionalConfigValue('keywords') as string | null;
                let keywords: string[];
                if (keywordsRaw) {
                    keywords = keywordsRaw.split(/\s+/).filter(Boolean);
                } else {
                    const userInput = (context.get('user_input') as string | null) ?? '';
                    keywords = extractKeywords(userInput);
                }
                if (keywords.length === 0) {
                    context.set('error', 'No keywords available for keyword probe.');
                    return this.result(ResultStatus.ERROR, 'No keywords for probe.');
                }
                result = await probeAll(keywords, { entityTypes });
            }

            context.set(contextPath, result);
            context.set(`${contextPath}_hint`, result.hint);

            const totalMatches = result.sources.reduce((n, s) => n + s.matches.reduce((m, t) => m + t.count, 0), 0);
            if (totalMatches === 0) {
                return this.result('no_results', 'No matches found across federated sources.');
            }
            return this.result(ResultStatus.OK, `Probed ${result.sources.length} source(s), ${totalMatches} total match(es).`);

        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            context.set('error', msg);
            return this.result(ResultStatus.ERROR, `FCP probe failed: ${msg}`);
        }
    }

    private resolveDate(context: Context): string | null {
        const fromConfig = this.getOptionalConfigValue('date') as string | null;
        if (fromConfig) return this.interpolate(fromConfig, context);
        const fromContext = context.get('date') as string | null;
        if (fromContext) return fromContext;
        // Fall back to today
        return new Date().toISOString().slice(0, 10);
    }
}
