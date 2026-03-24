// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Entity Catalog Source
// ─────────────────────────────────────────────────────────────────────────────
//
// Generates CatalogNodes for all entity types loaded from the schema.
// Each type gets: list, find, create, update, delete, sort, review, questions.
// Each field on each type gets a dedicated set_{type}_{field} catalog node
// so the LLM can set any field without needing to know the update_entity API.
// ─────────────────────────────────────────────────────────────────────────────

import type { CatalogNode } from './catalog-node.js';
import type { CatalogSource } from './catalog.js';
import type { EntityTypeConfig, FieldDef } from '../../entities/entity-type-config.js';

export class EntityCatalogSource implements CatalogSource {
    private readonly types: EntityTypeConfig[];

    constructor(types: EntityTypeConfig[]) {
        this.types = types;
    }

    getCatalogNodes(): CatalogNode[] {
        const nodes: CatalogNode[] = [];

        for (const cfg of this.types) {
            nodes.push(...this.nodesForType(cfg));
        }

        // Cross-type search — always available regardless of entity types
        nodes.push({
            key: 'search_all_entities',
            nodeCodeKey: 'search_entities',
            name: 'Search All Entities',
            group: 'entity',
            description: 'Full-text search across all entity types by keyword. Searches titles, tags, and body content. Returns results ranked by relevance.',
            configuration: { context_path: 'entities' },
        });

        // Create new entity type — lets the LLM design and register custom content types
        nodes.push({
            key: 'create_content_type',
            nodeCodeKey: 'create_entity_type',
            name: 'Create Content Type',
            group: 'entity',
            description: 'Creates a new content type (entity type) with LLM-designed fields. Use when the user mentions a kind of thing that doesn\'t exist yet (e.g. "recipe", "habit", "bookmark"). Requires type_name (singular slug) and description (what it represents).',
            configuration: {},
        });

        // Update existing entity type — add fields to a content type that already exists
        nodes.push({
            key: 'update_content_type',
            nodeCodeKey: 'update_entity_type',
            name: 'Update Content Type',
            group: 'entity',
            description: 'Adds a field to an existing content type. Use when the user wants to track an additional piece of information on an entity type that already exists. Requires type_name and the field to add.',
            configuration: {},
        });

        // Link entities — adds a labeled relationship between two entities
        nodes.push({
            key: 'link_entities',
            nodeCodeKey: 'link_entities',
            name: 'Link Entities',
            group: 'entity',
            description: 'Creates a labeled link from one entity to another (e.g. a task "blocks" another task, a goal "relates-to" a note). Requires source_entity_type, source_entity_title, target_entity_type, target_entity_title, and label.',
            configuration: {},
        });

        // Hardcoded recurring task node — always available regardless of entity types
        nodes.push({
            key: 'create_recurring_task',
            nodeCodeKey: 'create_recurring_task',
            name: 'Create Recurring Task',
            group: 'entity',
            description: 'Creates a recurring/repeating task or event that generates instances on a schedule (daily, weekly, or monthly). Use this instead of create_task when the user wants something that repeats. Requires a title, cadence, and optionally day_of_week, day_of_month, or priority.',
            configuration: {},
        });

        nodes.push(...this.importPipelineNodes());

        return nodes;
    }

    // ── Per-type node generation ────────────────────────────────────────────

    private nodesForType(cfg: EntityTypeConfig): CatalogNode[] {
        const nodes: CatalogNode[] = [];
        const { name: type, plural, fields, description: typeDesc } = cfg;

        const fieldKeys = fields.map(f => f.key).join(',');
        // Build a suffix like " (calendar events and appointments)" from the type description
        const descSuffix = typeDesc ? ` — ${typeDesc.charAt(0).toLowerCase()}${typeDesc.slice(1)}` : '';

        // Standard CRUD
        nodes.push({
            key: `list_${plural}`,
            nodeCodeKey: 'list_entities',
            name: `List ${cap(plural)}`,
            group: 'entity',
            description: `Lists all ${plural} in the active project${descSuffix}.`,
            configuration: { entity_type: type, context_path: 'entities' },
        });

        nodes.push({
            key: `search_${plural}`,
            nodeCodeKey: 'search_entities',
            name: `Search ${cap(plural)}`,
            group: 'entity',
            description: `Full-text search across ${plural} by keyword${descSuffix}. Searches titles, tags, and body content.`,
            configuration: { entity_type: type, context_path: 'entities' },
        });

        nodes.push({
            key: `find_${type}`,
            nodeCodeKey: 'find_entity',
            name: `Find ${cap(type)}`,
            group: 'entity',
            description: `Finds a ${type} by title${descSuffix}. Sets "entity" in context.`,
            configuration: { entity_type: type, title_context_key: 'title', context_path: 'entity' },
        });

        nodes.push({
            key: `create_${type}`,
            nodeCodeKey: 'create_entity',
            name: `Create ${cap(type)}`,
            group: 'entity',
            description: `Creates a new ${type}${descSuffix}.${fields.length > 0 ? ` Fields: ${fields.map(f => f.key).join(', ')}.` : ''}`,
            configuration: fieldKeys
                ? { entity_type: type, extra_fields: fieldKeys }
                : { entity_type: type },
        });

        nodes.push({
            key: `update_${type}`,
            nodeCodeKey: 'update_entity',
            name: `Update ${cap(type)}`,
            group: 'entity',
            description: `Updates an existing ${type} by title${descSuffix}.`,
            configuration: fieldKeys
                ? { entity_type: type, patch_fields: fieldKeys }
                : { entity_type: type },
        });

        nodes.push({
            key: `delete_${type}`,
            nodeCodeKey: 'delete_entity',
            name: `Delete ${cap(type)}`,
            group: 'entity',
            description: `Deletes a ${type} by title${descSuffix}.`,
            configuration: { entity_type: type },
        });

        // Complete node for types with a completion field
        if (cfg.completionField) {
            nodes.push({
                key: `complete_${type}`,
                nodeCodeKey: 'complete_entity',
                name: `Complete ${cap(type)}`,
                group: 'entity',
                description: `Marks a ${type} as ${cfg.completionValue ?? 'complete'}.`,
                configuration: { entity_type: type },
            });
        }

        // Sort
        const sortBy = this.deriveSortBy(fields);
        nodes.push({
            key: `sort_${plural}`,
            nodeCodeKey: 'sort_entities',
            name: `Sort ${cap(plural)}`,
            group: 'entity',
            description: `Sorts a ${plural} array by configurable fields.`,
            configuration: sortBy
                ? { context_path: 'entities', sort_by: sortBy }
                : { context_path: 'entities' },
        });

        // Vault context + AI review + questions
        nodes.push({
            key: `load_vault_context_${type}`,
            nodeCodeKey: 'load_vault_context',
            name: `Load Vault Context for ${cap(type)}`,
            group: 'entity',
            description: `Collects .vault.md context chain for ${plural}.`,
            configuration: { entity_type: type, context_path: 'vault_context' },
        });

        nodes.push({
            key: `review_${type}`,
            nodeCodeKey: 'llm_chat',
            name: `Review ${cap(type)}`,
            group: 'entity',
            description: `Reviews a ${type} and provides constructive feedback.`,
            configuration: {
                capability: 'reason',
                system_prompt: `You are a thoughtful reviewer. Analyse the ${type} provided and give constructive, actionable feedback on clarity, completeness, and quality. Be specific.\n\nContext:\n{vault_context}`,
                prompt: `Please review this ${type}:\n\n{entity}\n\nProvide your review with specific suggestions for improvement.`,
                response_context_path: 'llm_response',
            },
        });

        nodes.push({
            key: `questions_${type}`,
            nodeCodeKey: 'llm_chat',
            name: `Questions for ${cap(type)}`,
            group: 'entity',
            description: `Generates probing questions about a ${type}.`,
            configuration: {
                capability: 'reason',
                system_prompt: `You are a curious analyst. Given a ${type}, generate insightful questions that probe for gaps, unstated assumptions, and next steps. Be concise and number your questions.\n\nContext:\n{vault_context}`,
                prompt: `Here is a ${type}:\n\n{entity}\n\nWhat questions should be asked about this ${type}?`,
                response_context_path: 'llm_response',
            },
        });

        // Add tag — convenience node for appending tags without replacing
        nodes.push({
            key: `add_tag_${type}`,
            nodeCodeKey: 'update_entity',
            name: `Add Tag to ${cap(type)}`,
            group: 'entity',
            description: `Appends one or more tags to an existing ${type} without removing existing tags. Set add_tags to a comma-separated list of tags. Uses entity_title (supports {title} interpolation) to find the entity.`,
            configuration: {
                entity_type: type,
                entity_title: '{title}',
            },
        });

        // ── set_{type}_{field} nodes ──────────────────────────────────────
        // One catalog node per field so the LLM can target a specific field
        // without needing to wire up the full update_entity patch_fields dance.
        for (const field of fields) {
            nodes.push(this.setFieldNode(type, field));
        }

        return nodes;
    }

    // ── set_entity_field catalog node for one field ─────────────────────────

    private setFieldNode(type: string, field: FieldDef): CatalogNode {
        const key = `set_${type}_${field.key}`;
        const label = field.label ?? field.key;

        let description = `Sets the "${label}" field on a ${type}.`;
        if (field.type === 'enum' && field.values?.length) {
            description += ` Allowed values: ${field.values.join(', ')}.`;
        }
        if (field.type === 'boolean') {
            description += ' Value should be "true" or "false".';
        }

        return {
            key,
            nodeCodeKey: 'set_entity_field',
            name: `Set ${cap(type)} ${cap(label)}`,
            group: 'entity',
            description,
            configuration: {
                entity_type: type,
                field: field.key,
                // value left unset so the process/LLM provides it via context or config
            },
        };
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private deriveSortBy(fields: FieldDef[]): string {
        const priority = fields.find(f => f.key === 'priority');
        const status = fields.find(f => f.key === 'status');
        const date = fields.find(f => f.type === 'date' || f.type === 'datetime');
        const parts = [priority?.key, date?.key, status?.key].filter(Boolean) as string[];
        return parts.join(',');
    }

    // ── Import pipeline nodes (not entity-type-specific) ───────────────────

    private importPipelineNodes(): CatalogNode[] {
        return [
            {
                key: 'import_classify',
                nodeCodeKey: 'llm_chat',
                name: 'Import — Classify Document',
                group: 'import',
                description: 'LLM multi-entity extraction from an inbox document.',
                configuration: {
                    capability: 'reason',
                    system_prompt: 'You are a document classifier. Analyze content and extract structured entities. Always respond with valid JSON only.',
                    prompt: `Analyze the following document and extract ALL discrete items.
A single document may contain multiple items of different types.

Classify each item into one of these categories:
- note: General information, ideas, thoughts, meeting notes
- task: Tasks, action items, things to do, reminders
- event: Scheduled activities with specific dates/times
- research: Reference material, articles, documentation
- goal: Aspirations, objectives, long-term targets
- person: People, contacts, team members, stakeholders

For each item, return a FLAT JSON object (no nesting) with these fields:
- category: one of the above
- title: A clear, concise title
- content: The cleaned-up content in markdown format
- tags: array of relevant keywords

Plus type-specific fields AT THE TOP LEVEL:
- task: priority (low/medium/high), dueDate (YYYY-MM-DD), status ("open")
- event: startDate (ISO datetime), endDate (ISO datetime), location (string)
- research: status ("active"), sources (array of strings)
- goal: status ("active"), priority (low/medium/high), smart (object with specific/measurable/achievable/relevant/timeBound), milestones (array)
- person: company (string), group (string), phone (string), email (string), handle (string)
- note: no extra fields needed

Respond with a JSON array. Even for a single item, return an array:
[{"category":"task","title":"Buy groceries","content":"Pick up milk and bread","tags":["errands"],"priority":"medium","status":"open"}]

Original filename: {filename}

Content to analyze:
{file_content}`,
                    response_context_path: 'llm_response',
                },
            },
            {
                key: 'import_clean_json',
                nodeCodeKey: 'clean_llm_json',
                name: 'Import — Clean JSON',
                group: 'import',
                description: 'Strips code fences from the LLM classification response.',
                configuration: {
                    source_context_path: 'llm_response',
                    target_context_path: 'clean_json',
                },
            },
            {
                key: 'import_decode_json',
                nodeCodeKey: 'json_decode',
                name: 'Import — Decode JSON',
                group: 'import',
                description: 'Parses the cleaned JSON into an entities array.',
                configuration: {
                    source_context_path: 'clean_json',
                    target_context_path: 'entities',
                },
            },
            {
                key: 'import_iterate',
                nodeCodeKey: 'array_iterator',
                name: 'Import — Iterate Entities',
                group: 'import',
                description: 'Loops over extracted entities, spreading each into context.',
                configuration: {
                    source_context_path: 'entities',
                    cursor_context_path: '_import_cursor',
                    item_context_path: '_current_entity',
                    spread_fields: 'true',
                },
            },
            {
                key: 'import_route',
                nodeCodeKey: 'context_value_result',
                name: 'Import — Route by Category',
                group: 'import',
                description: 'Returns the entity category as the result status for edge-based routing.',
                configuration: {
                    context_path: 'category',
                },
            },
        ];
    }
}

function cap(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
