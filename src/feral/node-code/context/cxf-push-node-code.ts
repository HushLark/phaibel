// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — CXF Push NodeCode
//
// Records a sync for a named consumer and returns the CXF export URL.
// In v1, push is pull-based: this node records the consumer's sync timestamp
// and stores the export URL so the consumer knows where to pull from.
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { recordSync } from '../../../cxf/cxf-sync-state.js';

const DEFAULT_PORT = 3737;

export class CxfPushNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'consumer_id', name: 'Consumer ID', description: 'Identifier for the consuming system (stored in cxf-sync.json).', type: 'string' },
        { key: 'export_url_context_path', name: 'Export URL Path', description: 'Context key to store the CXF export URL. Default: cxf_export_url.', type: 'string', isOptional: true },
        { key: 'port', name: 'Port', description: 'Phaibel HTTP port. Default: 3737.', type: 'string', isOptional: true },
    ];

    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Sync recorded; export URL stored in context.' },
        { status: ResultStatus.ERROR, description: 'Failed to record sync.' },
    ];

    constructor() {
        super('cxf_push', 'CXF Push', 'Records a CXF sync for a consumer and stores the export URL in context. Consumers can then pull from the URL to receive updated entities.', NodeCodeCategory.DATA);
    }

    async process(context: Context): Promise<Result> {
        const consumerId = this.getRequiredConfigValue('consumer_id') as string;
        const urlPath = (this.getOptionalConfigValue('export_url_context_path') as string | null) ?? 'cxf_export_url';
        const portRaw = this.getOptionalConfigValue('port') as string | null;
        const port = portRaw ? parseInt(portRaw, 10) : DEFAULT_PORT;

        try {
            const syncTime = await recordSync(consumerId);
            const exportUrl = `http://localhost:${port}/api/cxf?consumer=${encodeURIComponent(consumerId)}&since=${syncTime}`;
            context.set(urlPath, exportUrl);
            context.set('cxf_sync_time', syncTime);
            return this.result(ResultStatus.OK, `Sync recorded for consumer "${consumerId}". Export URL: ${exportUrl}`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return this.result(ResultStatus.ERROR, `CXF push failed: ${msg}`);
        }
    }
}
