// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Result
// ─────────────────────────────────────────────────────────────────────────────
/** Well-known result status constants used as edge selectors */
export const ResultStatus = {
    OK: 'ok',
    SKIP: 'skip',
    STOP: 'stop',
    WARNING: 'warning',
    ERROR: 'error',
    TRUE: 'true',
    FALSE: 'false',
    PRIMARY: 'primary',
    SECONDARY: 'secondary',
    TERTIARY: 'tertiary',
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    GREATER_THAN: 'gt',
    GREATER_THAN_EQUAL: 'gte',
    LESS_THAN: 'lt',
    LESS_THAN_EQUAL: 'lte',
};
/** Factory helper */
export function createResult(status, message = '') {
    return { status, message };
}
