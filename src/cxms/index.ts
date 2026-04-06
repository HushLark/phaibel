// ─────────────────────────────────────────────────────────────────────────────
// CxMS — Context Management System
// ─────────────────────────────────────────────────────────────────────────────
// Public API for the Phaibel Context Management System.
// ─────────────────────────────────────────────────────────────────────────────

export type {
    ContextType,
    ContextNodeMeta,
    ContextNode,
    ContextReference,
    PresentationDate,
    Collection,
    FieldDef,
    FieldType,
    SpawnerConfig,
} from './types.js';

export {
    parseReference,
    formatReference,
    toContextType,
    FOUNDATION_MARKER,
    LEGACY_VAULT_MARKER,
} from './types.js';
