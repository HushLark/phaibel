// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — FCP Fetch NodeCode
//
// Fetches full node bodies from FCP sources using IDs from a prior probe.
// Reads the probe result from context (fcp_probe) and returns full nodes.
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { fetchAll } from '../../../federation/federator.js';
export class FcpFetchNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'probe_context_path', name: 'Probe Context Path', description: 'Context key holding the FCP probe result. Default: fcp_probe.', type: 'string', isOptional: true },
        { key: 'detail', name: 'Detail', description: '"full" (default) or "summary". Use summary to save tokens.', type: 'string', isOptional: true },
        { key: 'max_per_source', name: 'Max Per Source', description: 'Max IDs to fetch per source. Default: 5.', type: 'string', isOptional: true },
        { key: 'min_score', name: 'Min Score', description: 'Minimum relevance score (0–1) to include. Default: 0.5.', type: 'string', isOptional: true },
        { key: 'purpose', name: 'Purpose', description: 'Audit hint sent to the source describing why data is being fetched.', type: 'string', isOptional: true },
        { key: 'context_path', name: 'Context Path', description: 'Where to store fetched nodes. Default: fcp_nodes.', type: 'string', isOptional: true },
    ];
    static resultDescriptions = [
        { status: ResultStatus.OK, description: 'Nodes fetched successfully.' },
        { status: 'no_probe', description: 'No probe result in context — run fcp_probe first.' },
        { status: 'no_results', description: 'No nodes returned (all denied or no matches).' },
        { status: ResultStatus.ERROR, description: 'Fetch failed.' },
    ];
    constructor() {
        super('fcp_fetch', 'FCP Fetch', 'Fetch full node content from FCP sources using IDs from a prior fcp_probe result. Run fcp_probe first.', NodeCodeCategory.DATA);
    }
    async process(context) {
        const probeKey = this.getOptionalConfigValue('probe_context_path') ?? 'fcp_probe';
        const contextPath = this.getOptionalConfigValue('context_path') ?? 'fcp_nodes';
        const detail = (this.getOptionalConfigValue('detail') ?? 'full');
        const maxPerSource = parseInt(this.getOptionalConfigValue('max_per_source') ?? '5', 10);
        const minScore = parseFloat(this.getOptionalConfigValue('min_score') ?? '0.5');
        const purpose = this.getOptionalConfigValue('purpose') ?? undefined;
        const probeResult = context.get(probeKey);
        if (!probeResult) {
            return this.result('no_probe', 'No fcp_probe result in context. Run fcp_probe before fcp_fetch.');
        }
        // Build per-source fetch requests from probe samples, filtered by min score
        const requests = probeResult.sources
            .filter(s => s.matches.length > 0 && !s.error)
            .map(s => ({
            source: s.source,
            ids: s.matches
                .flatMap(m => m.samples)
                .filter(sample => sample.score >= minScore)
                .sort((a, b) => b.score - a.score)
                .slice(0, maxPerSource)
                .map(sample => sample.id),
        }))
            .filter(r => r.ids.length > 0);
        if (requests.length === 0) {
            return this.result('no_results', 'No samples met the minimum score threshold.');
        }
        try {
            const fetchResults = await fetchAll(requests, purpose);
            const allNodes = fetchResults.flatMap(r => r.nodes);
            if (allNodes.length === 0) {
                return this.result('no_results', 'All requested nodes were denied or empty.');
            }
            context.set(contextPath, allNodes);
            // Also store a compact text block for direct LLM injection
            const textBlock = allNodes.map(n => {
                const meta = n.meta ? Object.entries(n.meta).map(([k, v]) => `${k}: ${v}`).join(', ') : '';
                const body = detail === 'summary' ? (n.summary ?? '') : (n.body ?? n.summary ?? '');
                return `### ${n.title} [${n.type}]\n${meta ? `*${meta}*\n` : ''}${body}`;
            }).join('\n\n');
            context.set(`${contextPath}_text`, textBlock);
            return this.result(ResultStatus.OK, `Fetched ${allNodes.length} node(s) from ${fetchResults.length} source(s).`);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            context.set('error', msg);
            return this.result(ResultStatus.ERROR, `FCP fetch failed: ${msg}`);
        }
    }
}
