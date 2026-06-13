// ─────────────────────────────────────────────────────────────────────────────
// DIMENSION CALCULATOR
// Pure function that extracts and pre-computes relevance dimension data from
// a context node's metadata, based on the context type's dimension config.
// Called after every node write. Graph distance (degree) is preserved from
// the existing value and updated separately by the entity graph indexer.
// ─────────────────────────────────────────────────────────────────────────────

import { addDays } from '../entities/temporal-filter.js';
import type {
    EntityTypeConfig,
    TemporalDimensionConfig,
} from '../entities/entity-type-config.js';
import type {
    NodeDimensions,
    TemporalNodeDimension,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// ISO 8601 DURATION PARSER
// ─────────────────────────────────────────────────────────────────────────────

function parseDurationToEndDate(startDate: string, duration: string): string {
    const m = duration.match(
        /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/,
    );
    if (!m) return startDate;

    const d = new Date(startDate + 'T00:00:00Z');
    const years  = parseInt(m[1] ?? '0');
    const months = parseInt(m[2] ?? '0');
    const days   = parseFloat(m[3] ?? '0');
    const hours  = parseFloat(m[4] ?? '0');

    d.setUTCFullYear(d.getUTCFullYear() + years);
    d.setUTCMonth(d.getUTCMonth() + months);
    d.setUTCDate(d.getUTCDate() + Math.floor(days));
    if (hours >= 12) d.setUTCDate(d.getUTCDate() + 1); // half-day or longer → next day

    return d.toISOString().split('T')[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// TEMPORAL EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

export function extractTemporalDimension(
    meta: Record<string, unknown>,
    config: TemporalDimensionConfig,
): TemporalNodeDimension | undefined {
    const rawStart = meta[config.startField];
    if (!rawStart) return undefined;

    const start = String(rawStart).split('T')[0];
    if (start.length !== 10 || isNaN(Date.parse(start))) return undefined;

    let end: string | undefined;

    if (config.anchor === 'period') {
        if (config.endField && meta[config.endField]) {
            end = String(meta[config.endField]).split('T')[0];
        } else if (config.durationField && meta[config.durationField]) {
            end = parseDurationToEndDate(start, String(meta[config.durationField]));
        }
    }

    // relevantStart: salience attack begins windowBefore days ahead of start
    const relevantStart = addDays(start, -config.windowBefore);

    // relevantEnd: for periods, window extends from the end; for points, from the start
    const windowBase = config.anchor === 'period' && end ? end : start;
    const relevantEnd = addDays(windowBase, config.windowAfter);

    const archiveAfter = config.archiveDelay !== undefined
        ? addDays(relevantEnd, config.archiveDelay)
        : undefined;

    return { anchor: config.anchor, start, end, relevantStart, relevantEnd, archiveAfter };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute and return the NodeDimensions for a node based on its metadata
 * and the context type's dimension configuration.
 *
 * This is a pure extraction function: it reads from meta fields and applies
 * the type config rules. It never touches the filesystem or entity graph.
 *
 * Preserves existing semantic.indexed and graphDistance.degree values
 * so they survive re-computation on subsequent writes.
 */
export function computeNodeDimensions(
    meta: Record<string, unknown>,
    typeConfig: EntityTypeConfig,
): NodeDimensions {
    const defs = typeConfig.dimensions;
    if (!defs || defs.length === 0) return {};

    const existing = (meta.dimensions ?? {}) as NodeDimensions;
    const dims: NodeDimensions = {};

    for (const def of defs) {
        switch (def.type) {
            case 'temporal': {
                const temporal = extractTemporalDimension(meta, def.config);
                if (temporal) dims.temporal = temporal;
                break;
            }

            case 'semantic': {
                // Preserve indexed state — updated by the embedding indexer, not here
                dims.semantic = existing.semantic ?? { indexed: false };
                break;
            }

            case 'socialProximity': {
                // The relationship field is optional — me-anchored graph distance
                // applies regardless; this only stores the refining relationship.
                const field = def.config?.field;
                const rel = field ? meta[field] : undefined;
                if (typeof rel === 'string' && rel.length > 0) {
                    dims.socialProximity = { relationship: rel };
                }
                break;
            }

            case 'spatial': {
                const coords = meta[def.config.coordinatesField];
                if (coords && typeof coords === 'object') {
                    const { lat, lng } = coords as Record<string, unknown>;
                    if (typeof lat === 'number' && typeof lng === 'number') {
                        dims.spatial = { lat, lng };
                    }
                }
                break;
            }

            case 'recency': {
                const ts = meta.updated ?? meta.created;
                if (typeof ts === 'string' && ts.length > 0) {
                    dims.recency = { updatedAt: ts };
                }
                break;
            }

            // goalAlignment, behavioral, contextProximity carry no per-node
            // stored data — they are computed live at score time from the graph
            // and the behavioral index.
            case 'goalAlignment':
            case 'behavioral':
            case 'contextProximity':
                break;
        }
    }

    return dims;
}
