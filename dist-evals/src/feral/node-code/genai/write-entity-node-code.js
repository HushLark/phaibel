// ─────────────────────────────────────────────────────────────────────────────
// Feral Agent — Write Entity NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { AbstractNodeCode } from '../../node-code/abstract-node-code.js';
import { NodeCodeCategory } from '../../node-code/node-code.js';
import { ResultStatus } from '../../result/result.js';
/**
 * Persists an entity from context using a pluggable EntityPersister.
 */
export class WriteEntityNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'entity_type', name: 'Entity Type', description: 'Type/table name of the entity', type: 'string' },
        { key: 'source_context_path', name: 'Source Path', description: 'Context path containing the entity data', type: 'string' },
        { key: 'id_context_path', name: 'ID Path', description: 'Context path to store the persisted entity ID', type: 'string', isOptional: true, default: 'entity_id' },
    ];
    persister;
    constructor(persister) {
        super('write_entity', 'Write Entity', 'Persists an entity via pluggable EntityPersister', NodeCodeCategory.DATA);
        this.persister = persister;
    }
    setPersister(persister) {
        this.persister = persister;
    }
    async process(context) {
        if (!this.persister) {
            return this.result(ResultStatus.ERROR, 'No EntityPersister configured');
        }
        const entityType = this.getRequiredConfigValue('entity_type');
        const sourcePath = this.getRequiredConfigValue('source_context_path');
        const idPath = this.getOptionalConfigValue('id_context_path', 'entity_id');
        if (!context.has(sourcePath)) {
            return this.result(ResultStatus.ERROR, `No entity data at context path "${sourcePath}"`);
        }
        const data = context.get(sourcePath);
        try {
            const id = await this.persister.persist(entityType, data);
            context.set(idPath, id);
            return this.result(ResultStatus.OK, `Persisted ${entityType} with ID ${id}`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.result(ResultStatus.ERROR, `Entity persist error: ${message}`);
        }
    }
}
