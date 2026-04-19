// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Abstract NodeCode Base Class
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from '../context/context.js';
import type { ConfigurationValue } from '../configuration/configuration-value.js';
import { ConfigurationManager } from '../configuration/configuration-manager.js';
import type { Result } from '../result/result.js';
import { createResult, type ResultStatusValue } from '../result/result.js';
import { MissingConfigurationValueError } from '../errors.js';
import type { NodeCode, NodeCodeCategoryValue } from './node-code.js';

// Date pattern: YYYY-MM-DD (optionally followed by time)
const DATE_RE = /\d{4}-\d{2}-\d{2}/;

/**
 * Apply a pipe transform to a string value.
 *
 * Supported pipes:
 *   {key|date}              — extract first YYYY-MM-DD date
 *   {key|after:delim}       — everything after the first occurrence of delim (trimmed)
 *   {key|before:delim}      — everything before the first occurrence of delim (trimmed)
 *   {key|trim}              — trim whitespace
 *   {key|lower}             — lowercase
 *   {key|upper}             — uppercase
 *   {key|regex:pattern}     — extract first capture group (or full match) of regex
 */
function applyPipe(value: string, pipe: string): string {
    const colonIdx = pipe.indexOf(':');
    const pipeName = colonIdx >= 0 ? pipe.slice(0, colonIdx) : pipe;
    const pipeArg = colonIdx >= 0 ? pipe.slice(colonIdx + 1) : '';

    switch (pipeName) {
        case 'date': {
            const m = DATE_RE.exec(value);
            return m ? m[0] : value;
        }
        case 'after': {
            const idx = value.indexOf(pipeArg);
            return idx >= 0 ? value.slice(idx + pipeArg.length).trim() : value;
        }
        case 'before': {
            const idx = value.indexOf(pipeArg);
            return idx >= 0 ? value.slice(0, idx).trim() : value;
        }
        case 'trim':
            return value.trim();
        case 'lower':
            return value.toLowerCase();
        case 'upper':
            return value.toUpperCase();
        case 'regex': {
            try {
                const re = new RegExp(pipeArg);
                const m = re.exec(value);
                if (!m) return value;
                // Return first capture group if available, else full match
                return m[1] ?? m[0];
            } catch {
                return value;
            }
        }
        default:
            return value;
    }
}

/**
 * Base class for all NodeCode implementations.
 * Replaces PHP traits (NodeCodeMetaTrait, ResultsTrait, ConfigurationTrait, etc.)
 */
export abstract class AbstractNodeCode implements NodeCode {
    readonly key: string;
    readonly name: string;
    readonly description: string;
    readonly categoryKey: NodeCodeCategoryValue;
    protected configManager: ConfigurationManager;

    constructor(key: string, name: string, description: string, categoryKey: NodeCodeCategoryValue) {
        this.key = key;
        this.name = name;
        this.description = description;
        this.categoryKey = categoryKey;
        this.configManager = new ConfigurationManager();
    }

    addConfiguration(values: ConfigurationValue[]): void {
        this.configManager.merge(values);
    }

    /** Helper: create a Result */
    protected result(status: ResultStatusValue, message = ''): Result {
        return createResult(status, message);
    }

    /** Helper: get a required config value, throw if missing */
    protected getRequiredConfigValue(key: string, fallback?: unknown): unknown {
        const val = this.configManager.getValue(key);
        if (val != null) return val;
        if (fallback !== undefined) return fallback;
        throw new MissingConfigurationValueError(key);
    }

    /** Helper: get an optional config value */
    protected getOptionalConfigValue(key: string, fallback?: unknown): unknown {
        return this.configManager.getValue(key) ?? fallback ?? null;
    }

    /**
     * Replace {key} and {key|pipe} tokens in a template with context values.
     *
     * Simple:   {title}          → context.get('title')
     * Piped:    {title|date}     → extract YYYY-MM-DD from title
     *           {title|after:—}  → everything after "—"
     *           {title|regex:(\d{4}-\d{2}-\d{2})} → first capture group
     *
     * Multiple pipes can be chained: {title|after:—|trim|date}
     */
    protected interpolate(template: string, context: Context): string {
        return template.replace(/\{([^}]+)\}/g, (match, expr: string) => {
            const parts = expr.split('|');
            const key = parts[0].trim();

            // Key must be a simple identifier
            if (!/^\w+$/.test(key)) return match;

            let value = context.get(key);
            if (value === undefined || value === null) return '';

            let str = (typeof value === 'object') ? JSON.stringify(value) : String(value);

            // Apply pipe transforms
            for (let i = 1; i < parts.length; i++) {
                str = applyPipe(str, parts[i].trim());
            }

            return str;
        });
    }

    abstract process(context: Context): Promise<Result>;
}
