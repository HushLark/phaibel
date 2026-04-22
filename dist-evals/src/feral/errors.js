// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Error Classes
// ─────────────────────────────────────────────────────────────────────────────
export class FeralError extends Error {
    constructor(message) {
        super(message);
        this.name = 'FeralError';
    }
}
export class InvalidConfigurationError extends FeralError {
    constructor(message) {
        super(message);
        this.name = 'InvalidConfigurationError';
    }
}
export class InvalidNodeCodeKeyError extends FeralError {
    constructor(key) {
        super(`Invalid NodeCode key: "${key}"`);
        this.name = 'InvalidNodeCodeKeyError';
    }
}
export class InvalidNodeKeyError extends FeralError {
    constructor(key) {
        super(`Invalid node key: "${key}"`);
        this.name = 'InvalidNodeKeyError';
    }
}
export class MaximumNodeRunsError extends FeralError {
    constructor(key, max) {
        super(`Node "${key}" exceeded maximum runs (${max})`);
        this.name = 'MaximumNodeRunsError';
    }
}
export class MissingConfigurationValueError extends FeralError {
    constructor(key) {
        super(`Missing required configuration value: "${key}"`);
        this.name = 'MissingConfigurationValueError';
    }
}
export class ProcessError extends FeralError {
    constructor(message) {
        super(message);
        this.name = 'ProcessError';
    }
}
export class ModelSchemaNotFoundError extends FeralError {
    constructor(key) {
        super(`Model schema not found: "${key}"`);
        this.name = 'ModelSchemaNotFoundError';
    }
}
export class AgentMaxIterationsError extends FeralError {
    constructor(maxIterations) {
        super(`Agent exceeded maximum iterations (${maxIterations})`);
        this.name = 'AgentMaxIterationsError';
    }
}
