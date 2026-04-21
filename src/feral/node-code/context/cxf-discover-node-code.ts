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
        super('cxf_discover', 'CXF Discover', 'Discover the context types exposed by a remote CXF system by parsing its VSCHEMA blocks. No LLM required.', NodeCodeCategory.DATA);
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
            const types = parseVSchemas(body);

            if (types.length === 0) {
                return this.result('no_schema', `No VSCHEMA blocks found at ${url}.`);
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

function parseVSchemas(cxfText: string): DiscoveredType[] {
    const types: DiscoveredType[] = [];
    // Unfold continuation lines (CRLF + space/tab)
    const unfolded = cxfText.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
    const blocks = unfolded.split(/BEGIN:VSCHEMA/);

    for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i].split('END:VSCHEMA')[0];
        const lines = block.split(/\r?\n/).filter(Boolean);

        const type: DiscoveredType = { name: '', plural: '', fields: [] };

        for (const line of lines) {
            if (line.startsWith('X-CXF-TYPE-NAME:')) type.name = line.slice('X-CXF-TYPE-NAME:'.length).trim();
            else if (line.startsWith('X-CXF-PLURAL:')) type.plural = line.slice('X-CXF-PLURAL:'.length).trim();
            else if (line.startsWith('X-CXF-DESCRIPTION:')) type.description = line.slice('X-CXF-DESCRIPTION:'.length).trim().replace(/\\n/g, '\n');
            else if (line.startsWith('X-CXF-FIELD;')) {
                const field = parseFieldLine(line);
                if (field) type.fields.push(field);
            }
        }

        if (type.name) types.push(type);
    }

    return types;
}

function parseFieldLine(line: string): DiscoveredField | null {
    // X-CXF-FIELD;KEY=foo;TYPE=TEXT;REQUIRED=TRUE;VALUES=a,b:Label
    const semicolonPart = line.slice('X-CXF-FIELD;'.length);
    const colonIdx = semicolonPart.indexOf(':');
    if (colonIdx < 0) return null;
    const params = semicolonPart.slice(0, colonIdx);
    const label = semicolonPart.slice(colonIdx + 1);
    const paramMap: Record<string, string> = {};
    for (const p of params.split(';')) {
        const [k, v] = p.split('=');
        if (k && v !== undefined) paramMap[k] = v;
    }
    if (!paramMap.KEY) return null;
    return {
        key: paramMap.KEY,
        type: paramMap.TYPE ?? 'TEXT',
        label,
        required: paramMap.REQUIRED === 'TRUE',
        values: paramMap.VALUES ? paramMap.VALUES.split(',') : undefined,
    };
}
