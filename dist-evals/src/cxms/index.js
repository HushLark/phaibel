// ─────────────────────────────────────────────────────────────────────────────
// CxMS — Context Management System
// ─────────────────────────────────────────────────────────────────────────────
// Public API for the Phaibel Context Management System.
// ─────────────────────────────────────────────────────────────────────────────
export { parseReference, formatReference, toContextType, FOUNDATION_MARKER, LEGACY_VAULT_MARKER, } from './types.js';
export { loadContextTypesFromStore, writeContextType, writeMappingIndex, writeAllContextTypes, removeContextTypeDir, } from './context-type-store.js';
export { listCollections, loadCollection, getCollectionItem, countCollectionItems, saveCollection, setCollectionItem, removeCollectionItem, deleteCollection, } from './collections.js';
export { assertWithinFoundation, assertWithinRoot, BoundaryViolationError } from './boundary-guard.js';
export { logAccess, resetAccessLogPath } from './access-log.js';
export { handleCxRoute } from './cx-router.js';
export { problemResponse, badRequest, notFound, serverError, jsonResponse } from './problem-details.js';
