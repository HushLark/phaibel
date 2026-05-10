import type { EntityIndex } from '../entities/entity-index.js';
import type { EntityTypeConfig } from '../entities/entity-type-config.js';
import type { MomentContext } from './moment.js';

export interface ContextManifestEntityType {
    type: string;
    plural: string;
    count: number;
    description: string;
    fields: string[];
    dateRange?: { earliest: string; latest: string };
    recentSamples: Array<{ id: string; title: string; tags: string[] }>;
}

export interface ContextManifest {
    entityTypes: ContextManifestEntityType[];
    totalEntities: number;
    currentDate: string;
    currentTime: string;
}

export function buildContextManifest(
    entityIndex: EntityIndex,
    entityTypes: EntityTypeConfig[],
    moment: MomentContext,
    relevantTypes?: string[],
): ContextManifest {
    const stats = entityIndex.getStats();

    // Prioritize relevant types first, then include rest with entities
    const sortedTypes = relevantTypes && relevantTypes.length > 0
        ? [
            ...entityTypes.filter(et => relevantTypes.includes(et.name)),
            ...entityTypes.filter(et => !relevantTypes.includes(et.name)),
        ]
        : entityTypes;

    const manifestTypes: ContextManifestEntityType[] = [];

    for (const et of sortedTypes) {
        const count = stats.byType[et.name] || 0;
        // Skip types with no entities unless explicitly relevant
        if (count === 0 && !relevantTypes?.includes(et.name)) continue;

        const nodes = entityIndex.getNodes(et.name);
        const dateFieldKeys = et.fields
            .filter(f => f.type === 'date' || f.type === 'datetime' || f.type === 'date-fixed' || f.type === 'date-floating')
            .map(f => f.key);

        let earliest: string | undefined;
        let latest: string | undefined;
        for (const node of nodes) {
            for (const key of dateFieldKeys) {
                const val = node.meta[key];
                if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
                    if (!earliest || val < earliest) earliest = val;
                    if (!latest || val > latest) latest = val;
                }
            }
        }

        manifestTypes.push({
            type: et.name,
            plural: et.plural,
            count,
            description: et.description || et.name,
            fields: et.fields.map(f => f.key),
            ...(earliest && latest ? { dateRange: { earliest, latest } } : {}),
            recentSamples: nodes.slice(0, 5).map(n => ({
                id: n.id,
                title: n.name,
                tags: n.tags,
            })),
        });
    }

    return {
        entityTypes: manifestTypes,
        totalEntities: stats.nodeCount,
        currentDate: moment.current_date,
        currentTime: moment.current_time,
    };
}

export function serializeManifest(manifest: ContextManifest): string {
    return JSON.stringify(manifest, null, 2);
}
