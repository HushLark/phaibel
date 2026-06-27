// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — CF/x3 Sync NodeCode: pull a federated source into CxMS on demand.
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { syncSourceById } from '../../../cfx3/service.js';

export class Cfx3SyncNodeCode extends AbstractNodeCode {
    readonly allowExtraConfig = true;

    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'source_id', name: 'Source ID', description: 'The CF/x3 source to sync into CxMS.', type: 'string' },
        { key: 'full', name: 'Full Sync', description: 'Ignore the cursor and pull everything.', type: 'boolean', isOptional: true },
        { key: 'result_context_path', name: 'Result Path', description: 'Context key to store the sync outcome.', type: 'string', default: 'cfx3_sync_result' },
    ];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Source synced into CxMS.' },
        { status: ResultStatus.ERROR, description: 'Sync failed.' },
    ];

    constructor() {
        super('cfx3_sync', 'CF/x3 Sync', 'Pull a federated CF/x3 source into CxMS.', NodeCodeCategory.DATA);
    }

    async process(context: Context): Promise<Result> {
        const sourceId = this.getRequiredConfigValue('source_id') as string;
        const full = this.getOptionalConfigValue('full') === true;
        const resultPath = this.getRequiredConfigValue('result_context_path', 'cfx3_sync_result') as string;

        try {
            const outcome = await syncSourceById(sourceId, { full });
            context.set(resultPath, outcome);
            return this.result(ResultStatus.OK,
                `CF/x3 ${sourceId} synced: +${outcome.created} ~${outcome.updated} -${outcome.deleted}.`);
        } catch (err) {
            return this.result(ResultStatus.ERROR, `CF/x3 sync failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
