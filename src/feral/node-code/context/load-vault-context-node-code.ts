// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Load Vault Context NodeCode
// ─────────────────────────────────────────────────────────────────────────────
//
// Collects the hierarchical .vault.md context chain for an entity type
// (vault root → projects → project → entity subdirectory) and stores
// the combined text in the Feral context for downstream LLM nodes.
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { getSubdirectoryContext } from '../../../context/reader.js';
import { getEntityType } from '../../../entities/entity-type-config.js';

export class LoadVaultContextNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        {
            key: 'entity_type',
            name: 'Entity Type',
            description: 'The entity type whose .vault.md context to collect (any registered entity type).',
            type: 'string',
        },
        {
            key: 'context_path',
            name: 'Context Path',
            description: 'Context key to store the combined vault context.',
            type: 'string',
            default: 'vault_context',
        },
    ];

    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Vault context loaded successfully.' },
        { status: ResultStatus.ERROR, description: 'Failed to load vault context.' },
    ];

    constructor() {
        super(
            'load_vault_context',
            'Load Vault Context',
            'Collects .vault.md context from vault root through entity subdirectory.',
            NodeCodeCategory.DATA,
        );
    }

    async process(context: Context): Promise<Result> {
        const entityType = this.getRequiredConfigValue('entity_type') as string;
        const contextPath = this.getRequiredConfigValue('context_path', 'vault_context') as string;

        // Dynamically resolve directory from entity type config
        const typeConfig = await getEntityType(entityType);
        if (!typeConfig) {
            context.set('error', `Unknown entity type: ${entityType}`);
            return this.result(ResultStatus.ERROR, `Unknown entity type "${entityType}".`);
        }

        try {
            const vaultContext = await getSubdirectoryContext(typeConfig.directory);
            context.set(contextPath, vaultContext);

            return this.result(ResultStatus.OK, `Loaded vault context for ${entityType} (${typeConfig.directory}).`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            context.set('error', message);
            return this.result(ResultStatus.ERROR, `Failed to load vault context: ${message}`);
        }
    }
}
