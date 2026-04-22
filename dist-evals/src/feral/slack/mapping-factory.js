// ─────────────────────────────────────────────────────────────────────────────
// Feral Slack — Mapping Factory
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Generic factory that maps string keys to constructor functions.
 * Used for instantiating Block and Element types dynamically.
 */
export class MappingFactory {
    mapping;
    constructor(mapping) {
        this.mapping = new Map();
        for (const [key, ctor] of Object.entries(mapping)) {
            this.mapping.set(key.toLowerCase(), ctor);
        }
    }
    /**
     * Instantiate an object by its type key.
     */
    build(typeKey) {
        const Ctor = this.mapping.get(typeKey.toLowerCase());
        if (!Ctor) {
            throw new UnknownFactoryKeyError(typeKey, [...this.mapping.keys()]);
        }
        return new Ctor();
    }
    /**
     * Check if a type key is registered.
     */
    has(typeKey) {
        return this.mapping.has(typeKey.toLowerCase());
    }
    /**
     * Get all registered type keys.
     */
    getKeys() {
        return [...this.mapping.keys()];
    }
}
export class UnknownFactoryKeyError extends Error {
    constructor(key, validKeys) {
        super(`Unknown factory key "${key}". Valid keys: ${validKeys.join(', ')}`);
        this.name = 'UnknownFactoryKeyError';
    }
}
