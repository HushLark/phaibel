// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — CXF Discover NodeCode
//
// Calls a registered CXF system's endpoint with include_schema=true to
// discover the types it exposes. Parses VSCHEMA blocks and stores a type
// registry in context. No LLM required.
// ─────────────────────────────────────────────────────────────────────────────

import https from 'https';
import http from 'http';
import type { Context } from '../../context/context.js';
import type { Result } from '../../result/result.js';
import { ResultStatus } from '../../result/result.js';
import type { ConfigurationDescription, ResultDescription } from '../../configuration/configuration-description.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { getSystem, getCxfUrl } from '../../../cxf/cxf-systems.js';

export class CxfDiscoverNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'system_id', name: 'System ID', description: 'CXF system ID from cxf-systems.json.', type: 'string' },
        { key: 'result_context_path', name: 'Result Path', description: 'Context key to store discovered schema. Default: cxf_schema.', type: 'string', isOptional: true },
    ];

    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Schema discovered and stored in context.' },
        { status: 'no_schema', description: 'No VSCHEMA blocks found in response.' },
        { status: 'system_not_found', description: 'System ID not found in cxf-systems.json.' },
        { status: ResultStatus.ERROR, description: 'Request failed.' },
    ];

    constructor() {
        super('cxf_discover', 'CXF Discover', 'Discover the context types exposed by a remote CXF system by parsing its JSON-LD schema. No LLM required.', NodeCodeCategory.DATA);
    }

    async process(context: Context): Promise<Result> {
        const systemId = this.getRequiredConfigValue('system_id') as string;
        const resultPath = (this.getOptionalConfigValue('result_context_path') as string | null) ?? 'cxf_schema';

        const system = await getSystem(systemId);
        if (!system) {
            return this.result('system_not_found', `CXF system "${systemId}" not found in registry.`);
        }

        try {
            const baseUrl = getCxfUrl(system);
            const url = `${baseUrl}?include_schema=true&include_graph=false`;
            const body = await fetchText(url);
            const types = parseSchemas(body);

            if (types.length === 0) {
                return this.result('no_schema', `No schemas found at ${url}.`);
            }

            context.set(resultPath, { system: systemId, types });
            return this.result(ResultStatus.OK, `Discovered ${types.length} type(s) from ${system.name}.`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return this.result(ResultStatus.ERROR, `CXF discover failed: ${msg}`);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function fetchText(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        lib.get(url, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
            res.on('error', reject);
        }).on('error', reject);
    });
}

interface DiscoveredField {
    key: string;
    type: string;
    label: string;
    required: boolean;
    values?: string[];
}

interface DiscoveredType {
    name: string;
    plural: string;
    description?: string;
    fields: DiscoveredField[];
}

function parseSchemas(jsonText: string): DiscoveredType[] {
    let doc: Record<string, unknown>;
    try {
        doc = JSON.parse(jsonText);
    } catch {
        return [];
    }

    const schemas = doc['cxf:schemas'];
    if (!Array.isArray(schemas)) return [];

    const types: DiscoveredType[] = [];
    for (const s of schemas as Record<string, unknown>[]) {
        const name = s['cxf:typeName'];
        const plural = s['cxf:plural'];
        if (!name) continue;

        const type: DiscoveredType = {
            name: String(name),
            plural: plural ? String(plural) : String(name),
            fields: [],
        };

        if (s['cxf:description']) type.description = String(s['cxf:description']);

        const fields = s['cxf:fields'];
        if (Array.isArray(fields)) {
            for (const f of fields as Record<string, unknown>[]) {
                const key = f['cxf:key'];
                if (!key) continue;
                const fd: DiscoveredField = {
                    key: String(key),
                    type: f['cxf:type'] ? String(f['cxf:type']) : 'text',
                    label: f['cxf:label'] ? String(f['cxf:label']) : String(key),
                    required: f['cxf:required'] === true,
                };
                if (Array.isArray(f['cxf:values'])) {
                    fd.values = (f['cxf:values'] as unknown[]).map(String);
                }
                type.fields.push(fd);
            }
        }

        types.push(type);
    }

    return types;
}
