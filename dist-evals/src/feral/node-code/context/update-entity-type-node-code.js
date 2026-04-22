// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Update Entity Type NodeCode
// ─────────────────────────────────────────────────────────────────────────────
//
// Given a type name and a plain-English description of the changes, asks the
// LLM to produce an updated field schema, then saves it to entity-types.json.
//
// Config:
//   type_name   — the existing entity type to update
//   changes     — plain-English description of what to add/remove/change
//
// Context output:
//   entity_type — the updated EntityTypeConfig
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { getEntityType, updateEntityType, } from '../../../entities/entity-type-config.js';
import { getModelForCapability } from '../../../llm/router.js';
const NOT_FOUND = 'not_found';
const SYSTEM_PROMPT = `You are a data modelling assistant for a personal knowledge-management CLI called Phaibel.
You will be given the current JSON schema for an entity type and a description of requested changes.
Apply the changes and return the complete updated schema as a JSON object.

Rules:
- Return ONLY a valid JSON object — no markdown, no commentary, no code fences.
- The object must have these top-level keys:
    plural        : string
    description   : string  (≤ 80 chars)
    fields        : array of field objects
    completionField : string | null
    completionValue : string | null
- Each field object must have:
    key      : string  (camelCase, no spaces)
    label    : string
    type     : one of: string | number | boolean | date | datetime | enum
    required : boolean
- Enum fields must also include:
    values   : string[]
    default  : string  (must be in values)
- Preserve existing fields unless the changes explicitly remove or rename them.
- NEVER create a field called "name" or "title". Every entity already has a built-in title — adding a name/title field causes duplication and validation failures. If one exists, remove it.
- calendarDateField: If the type has a date or datetime field that represents WHEN this thing happens or is due, set calendarDateField to that field's key so it appears on the user's timeline. Preserve the existing value unless the changes affect it.
- The object must also include:
    calendarDateField : string | null   (which date/datetime field places this entity on the timeline)`;
export class UpdateEntityTypeNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        {
            key: 'type_name',
            name: 'Type Name',
            description: 'The name of the entity type to update. Supports {context_key} interpolation.',
            type: 'string',
        },
        {
            key: 'changes',
            name: 'Changes',
            description: 'Plain-English description of what to add, remove, or change. Supports {context_key} interpolation.',
            type: 'string',
        },
    ];
    static resultDescriptions = [
        { status: ResultStatus.OK, description: 'Entity type updated successfully.' },
        { status: NOT_FOUND, description: 'Entity type not found.' },
        { status: ResultStatus.ERROR, description: 'Failed to update entity type.' },
    ];
    constructor() {
        super('update_entity_type', 'Update Entity Type', 'Uses the LLM to apply field schema changes to an existing entity type.', NodeCodeCategory.DATA);
    }
    async process(context) {
        const rawName = this.getRequiredConfigValue('type_name');
        const rawChanges = this.getRequiredConfigValue('changes');
        const typeName = this.interpolate(rawName, context).trim();
        const changes = this.interpolate(rawChanges, context).trim();
        const existing = await getEntityType(typeName);
        if (!existing) {
            context.set('error', `Entity type "${typeName}" not found.`);
            return this.result(NOT_FOUND, `Entity type "${typeName}" not found.`);
        }
        const userPrompt = `Current schema for "${typeName}":\n${JSON.stringify(existing, null, 2)}\n\nRequested changes:\n${changes}`;
        let schemaJson;
        try {
            const llm = await getModelForCapability('reason');
            schemaJson = await llm.chat([{ role: 'user', content: userPrompt }], { systemPrompt: SYSTEM_PROMPT, temperature: 0.2, maxTokens: 1024 });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            context.set('error', `LLM call failed: ${msg}`);
            return this.result(ResultStatus.ERROR, `LLM call failed: ${msg}`);
        }
        let schema;
        try {
            const cleaned = schemaJson.replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();
            schema = JSON.parse(cleaned);
        }
        catch {
            context.set('error', 'LLM returned invalid JSON.');
            return this.result(ResultStatus.ERROR, `LLM returned invalid JSON: ${schemaJson.slice(0, 200)}`);
        }
        if (!Array.isArray(schema.fields)) {
            context.set('error', 'LLM schema missing "fields" array.');
            return this.result(ResultStatus.ERROR, 'LLM schema missing "fields" array.');
        }
        const updated = {
            ...existing,
            plural: schema.plural ?? existing.plural,
            description: schema.description ?? existing.description,
            fields: schema.fields,
        };
        if (schema.completionField) {
            updated.completionField = schema.completionField;
            updated.completionValue = schema.completionValue ?? undefined;
        }
        else if (schema.completionField === null) {
            delete updated.completionField;
            delete updated.completionValue;
        }
        if (schema.calendarDateField) {
            updated.calendarDateField = schema.calendarDateField;
        }
        else if (schema.calendarDateField === null) {
            delete updated.calendarDateField;
        }
        await updateEntityType(typeName, updated);
        context.set('entity_type', updated);
        return this.result(ResultStatus.OK, `Updated entity type "${typeName}" — now has ${updated.fields.length} field(s).`);
    }
}
