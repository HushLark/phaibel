// ─────────────────────────────────────────────────────────────────────────────
// Feral Agent — Model Schema & Registry
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Registry for model schemas used by GenAI NodeCodes.
 * Models are registered at bootstrap time and referenced by key.
 */
export class ModelSchemaRegistry {
    schemas = new Map();
    register(schema) {
        this.schemas.set(schema.key, schema);
    }
    get(key) {
        const schema = this.schemas.get(key);
        if (!schema) {
            throw new Error(`Model schema "${key}" not found in registry.`);
        }
        return schema;
    }
    has(key) {
        return this.schemas.has(key);
    }
    getAll() {
        return Array.from(this.schemas.values());
    }
    /**
     * Generate a JSON Schema-like prompt description for a model.
     */
    toPromptText(key) {
        const schema = this.get(key);
        const props = schema.properties.map(p => {
            const req = p.required ? ' (required)' : ' (optional)';
            return `  - ${p.name}: ${p.type}${req} — ${p.description}`;
        });
        return [
            `Model: ${schema.name}`,
            `Description: ${schema.description}`,
            `Properties:`,
            ...props,
        ].join('\n');
    }
}
