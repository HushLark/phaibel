// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Create Entity Type NodeCode
// ─────────────────────────────────────────────────────────────────────────────
//
// Given a type name and plain-English description, asks the LLM to design the
// field schema, then registers the new entity type in ~/.phaibel/entity-types.json.
//
// Config:
//   type_name    — singular slug, e.g. "person" or "album"
//   description  — what this entity represents, e.g. "A music album to remember"
//
// Context output:
//   entity_type  — the full EntityTypeConfig that was created
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { addEntityType, type EntityTypeConfig, type FieldDef } from '../../../entities/entity-type-config.js';
import { BASE_CATEGORIES, type BaseCategory } from '../../../entities/base-categories.js';
import { getModelForCapability } from '../../../llm/router.js';

const ALREADY_EXISTS = 'already_exists';

const SYSTEM_PROMPT = `You are a data modelling assistant for Phaibel, a personal organizer.
Given a type name and description, produce a JSON object defining the fields for that entity type.

PHILOSOPHY: Content types help a human stay organized. Keep them SIMPLE. Only include fields the user would actually fill in when quickly capturing information. The user can always add more fields later.

Rules:
- Return ONLY a valid JSON object — no markdown, no commentary, no code fences.
- The object must have these top-level keys:
    plural        : string  (plural form of the type name)
    description   : string  (short description ≤ 80 chars)
    baseCategory  : one of: person | place | thing | event | task | goal
    parent        : string | null   (an existing more-general type this specializes, or null)
    fields        : array of field objects (see below)
    completionField : string | null   (which field tracks done/complete state, or null)
    completionValue : string | null   (the value that means done, or null)
- Each field object must have:
    key      : string  (camelCase identifier, no spaces)
    label    : string  (human-readable label)
    type     : one of: string | number | boolean | date | datetime | enum
    required : boolean
- Enum fields must also include:
    values   : string[]  (allowed values)
    default  : string    (the default value, must be in values)
- STRICT LIMIT: 3–5 fields maximum. Think "what would I jot on a sticky note?" — only the essential identifying details.
  Example: a "flight" needs departureDate, airline, flightNumber — NOT cabin class, aircraft type, wifi, entertainment, boarding time.
  Example: a "recipe" needs prepTime, servings — NOT cuisine, difficulty, calories, equipment.
- REQUIRED FIELDS: Set required: false for MOST fields. The entity title already identifies it — extra fields are enrichment, not identity. Only mark a field required if the entity is truly meaningless without it AND there is no sensible default (e.g. a currency amount). When in doubt, mark it optional (required: false). For enum fields, always provide a default value so the field can auto-populate.
- NEVER create a field called "name" or "title". Every entity already has a built-in title — adding a name/title field causes duplication and validation failures.
- Only add a completionField/completionValue if the entity genuinely has a done/archived/complete state.
- Prefer "date" for date-only fields and "datetime" for fields that need a time component.
- calendarDateField: If the type has a date or datetime field that represents WHEN this thing happens or is due, set calendarDateField to that field's key so it appears on the user's timeline. Examples: a flight's "departureDate", an appointment's "date", a deadline's "dueDate". Set to null if the type has no meaningful temporal anchor.
- The object must also include:
    calendarDateField : string | null   (which date/datetime field places this entity on the timeline)
- baseCategory: which life primitive this rolls up to — it gives the type a relevance profile. Choose:
    person (people) · place (locations) · thing (objects, notes, records) ·
    event (things that happen over a span — meetings, concerts, trips) ·
    task (things to do with a deadline) · goal (outcomes you work toward).
- parent: if a more-general existing type clearly fits, set it (e.g. a "concert" specializes "event"); else null.
- SPECIFICITY: aim for a type that is specific to the user's life yet REUSABLE next month — a recurring kind, not a one-off. Good: "concert", "recital", "client", "1:1". Too generic: falling back to event/note when the kind clearly recurs. Too specific (avoid): "taylor_swift_concert", "tuesday_soccer".`;

export class CreateEntityTypeNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        {
            key: 'type_name',
            name: 'Type Name',
            description: 'Singular slug for the new entity type (e.g. "album", "person"). Supports {context_key} interpolation.',
            type: 'string',
        },
        {
            key: 'description',
            name: 'Description',
            description: 'Plain-English description of what this entity represents. Supports {context_key} interpolation.',
            type: 'string',
        },
    ];

    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Entity type created successfully.' },
        { status: ALREADY_EXISTS, description: 'An entity type with this name already exists.' },
        { status: ResultStatus.ERROR, description: 'Failed to create entity type.' },
    ];

    constructor() {
        super(
            'create_entity_type',
            'Create Entity Type',
            'Uses the LLM to design a field schema, then registers a new entity type.',
            NodeCodeCategory.DATA,
        );
    }

    async process(context: Context): Promise<Result> {
        const rawName = this.getRequiredConfigValue('type_name') as string;
        const rawDesc = this.getRequiredConfigValue('description') as string;

        const typeName = this.interpolate(rawName, context).trim().toLowerCase().replace(/\s+/g, '-');
        const description = this.interpolate(rawDesc, context).trim();

        if (!typeName) {
            context.set('error', 'type_name is required.');
            return this.result(ResultStatus.ERROR, 'type_name is required.');
        }

        // ── Ask LLM to design the schema ────────────────────────────────────
        const userPrompt = `Design the field schema for a "${typeName}" entity type.\n\nDescription: ${description}`;

        let schemaJson: string;
        try {
            const llm = await getModelForCapability('reason');
            schemaJson = await llm.chat(
                [{ role: 'user' as const, content: userPrompt }],
                { systemPrompt: SYSTEM_PROMPT, temperature: 0.2, maxTokens: 1024 },
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            context.set('error', `LLM call failed: ${msg}`);
            return this.result(ResultStatus.ERROR, `LLM call failed: ${msg}`);
        }

        // ── Parse and validate ───────────────────────────────────────────────
        let schema: {
            plural?: string;
            description?: string;
            baseCategory?: string;
            parent?: string | null;
            fields?: FieldDef[];
            completionField?: string | null;
            completionValue?: string | null;
            calendarDateField?: string | null;
        };
        try {
            // Strip any accidental code fences
            const cleaned = schemaJson.replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();
            schema = JSON.parse(cleaned);
        } catch {
            context.set('error', 'LLM returned invalid JSON.');
            return this.result(ResultStatus.ERROR, `LLM returned invalid JSON: ${schemaJson.slice(0, 200)}`);
        }

        if (!Array.isArray(schema.fields)) {
            context.set('error', 'LLM schema missing "fields" array.');
            return this.result(ResultStatus.ERROR, 'LLM schema missing "fields" array.');
        }

        const plural = (schema.plural ?? typeName + 's').trim();
        // Roll the new type up to a base category so it inherits a relevance
        // profile and participates in specificity. Default to 'thing' if the
        // model omitted/garbled it — never leave a created type uncategorized.
        const baseCategory: BaseCategory =
            BASE_CATEGORIES.includes(schema.baseCategory as BaseCategory)
                ? (schema.baseCategory as BaseCategory)
                : 'thing';
        const config: EntityTypeConfig = {
            name: typeName,
            plural,
            directory: `context-types/${typeName}`,
            description: schema.description ?? description,
            baseCategory,
            fields: schema.fields,
        };
        // Only set parent when it names a real, different existing type.
        if (schema.parent && schema.parent !== typeName) {
            const { getEntityType } = await import('../../../entities/entity-type-config.js');
            if (await getEntityType(schema.parent)) config.parent = schema.parent;
        }

        if (schema.completionField) {
            config.completionField = schema.completionField;
            config.completionValue = schema.completionValue ?? undefined;
        }

        if (schema.calendarDateField) {
            config.calendarDateField = schema.calendarDateField;
        }

        // ── Register ─────────────────────────────────────────────────────────
        try {
            await addEntityType(config);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('already exists')) {
                context.set('error', msg);
                return this.result(ALREADY_EXISTS, msg);
            }
            context.set('error', msg);
            return this.result(ResultStatus.ERROR, msg);
        }

        context.set('entity_type', config);

        // Accumulate into created_entity_types array for multi-step visibility
        const created = (context.get('created_entity_types') as unknown[] | undefined) ?? [];
        created.push({ name: typeName, plural, fields: config.fields.length });
        context.set('created_entity_types', created);

        return this.result(ResultStatus.OK, `Created entity type "${typeName}" with ${config.fields.length} field(s).`);
    }
}
