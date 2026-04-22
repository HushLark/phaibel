// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — List Entity Types NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { loadEntityTypes } from '../../../entities/entity-type-config.js';
export class ListEntityTypesNodeCode extends AbstractNodeCode {
    static configDescriptions = [];
    static resultDescriptions = [
        { status: ResultStatus.OK, description: 'Entity types listed successfully.' },
    ];
    constructor() {
        super('list_entity_types', 'List Entity Types', 'Loads all registered entity type schemas and stores them in context as "entity_types".', NodeCodeCategory.DATA);
    }
    async process(context) {
        const types = await loadEntityTypes();
        context.set('entity_types', types);
        return this.result(ResultStatus.OK, `Found ${types.length} entity type(s): ${types.map(t => t.name).join(', ')}`);
    }
}
