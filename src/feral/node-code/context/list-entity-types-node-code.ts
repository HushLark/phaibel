// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — List Entity Types NodeCode
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { loadEntityTypes } from '../../../entities/entity-type-config.js';

export class ListEntityTypesNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [];
    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Entity types listed successfully.' },
    ];

    constructor() {
        super(
            'list_entity_types',
            'List Entity Types',
            'Loads all registered entity type schemas and stores them in context as "entity_types".',
            NodeCodeCategory.DATA,
        );
    }

    async process(context: Context): Promise<Result> {
        const types = await loadEntityTypes();
        context.set('entity_types', types);
        return this.result(ResultStatus.OK, `Found ${types.length} entity type(s): ${types.map(t => t.name).join(', ')}`);
    }
}
