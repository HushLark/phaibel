// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — CXF Pull NodeCode
//
// Fetches CXF content from a registered system using GET {url}?since={cursor}.
// Parses the response into structured node records and stores them in context.
// Supports incremental sync via a cursor stored in context.
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

export interface CxfParsedNode {
    uid: string;
    entityId: string;
    vaultId: string;
    type: string;
    title: string;
    status?: string;
    tags: string[];
    created?: string;
    updated?: string;
    archived: boolean;
    deleted: boolean;
    fields: Record<string, string>;
    links: Array<{ target: string; label: string }>;
}

export class CxfPullNodeCode extends AbstractNodeCode {
    static readonly configDescriptions: ConfigurationDescription[] = [
        { key: 'system_id', name: 'System ID', description: 'CXF system ID from cxf-systems.json.', type: 'string' },
        { key: 'since_context_path', name: 'Since Context Path', description: 'Context key holding a Unix timestamp cursor. If absent, full export is fetched.', type: 'string', isOptional: true },
        { key: 'types', name: 'Types', description: 'Comma-separated type filter (e.g. task,event). Default: all.', type: 'string', isOptional: true },
        { key: 'result_context_path', name: 'Result Path', description: 'Context key to store parsed nodes. Default: cxf_nodes.', type: 'string', isOptional: true },
        { key: 'update_cursor', name: 'Update Cursor', description: 'Write new X-CXF-Export-Time back to since_context_path after pull. Default: true.', type: 'string', isOptional: true },
    ];

    static readonly resultDescriptions: ResultDescription[] = [
        { status: ResultStatus.OK, description: 'Nodes fetched and stored in context.' },
        { status: 'no_content', description: 'Response was empty or contained no nodes.' },
        { status: 'system_not_found', description: 'System ID not found in cxf-systems.json.' },
        { status: ResultStatus.ERROR, description: 'Request failed.' },
    ];

    constructor() {
        super('cxf_pull', 'CXF Pull', 'Fetch CXF content from a registered system. Supports incremental sync via a since-cursor stored in context.', NodeCodeCategory.DATA);
    }

    async process(context: Context): Promise<Result> {
        const systemId = this.getRequiredConfigValue('system_id') as string;
        const sinceContextPath = this.getOptionalConfigValue('since_context_path') as string | null;
        const typesFilter = this.getOptionalConfigValue('types') as string | null;
        const resultPath = (this.getOptionalConfigValue('result_context_path') as string | null) ?? 'cxf_nodes';
        const updateCursor = this.getOptionalConfigValue('update_cursor') !== 'false';

        const system = await getSystem(systemId);
        if (!system) {
            return this.result('system_not_found', `CXF system "${systemId}" not found in registry.`);
        }

        try {
            const baseUrl = getCxfUrl(system);
            const params = new URLSearchParams({ consumer: systemId });
            if (typesFilter) params.set('types', typesFilter);

            const sinceVal = sinceContextPath ? context.get(sinceContextPath) as number | string | null : null;
            if (sinceVal) params.set('since', String(sinceVal));

            const url = `${baseUrl}?${params.toString()}`;
            const { body, exportTime } = await fetchWithHeaders(url);
            const nodes = parseCxfNodes(body);

            const payload = { nodes, exportTime, entityCount: nodes.length };
            context.set(resultPath, payload);

            if (updateCursor && sinceContextPath && exportTime) {
                context.set(sinceContextPath, exportTime);
            }

            if (nodes.length === 0) {
                return this.result('no_content', `No nodes returned from ${system.name}.`);
            }
            return this.result(ResultStatus.OK, `Pulled ${nodes.length} node(s) from ${system.name}.`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return this.result(ResultStatus.ERROR, `CXF pull failed: ${msg}`);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function fetchWithHeaders(url: string): Promise<{ body: string; exportTime: number | null }> {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        lib.get(url, (res) => {
            const exportTimeHeader = res.headers['x-cxf-export-time'];
            const exportTime = exportTimeHeader ? parseInt(String(exportTimeHeader), 10) : null;
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf-8'), exportTime }));
            res.on('error', reject);
        }).on('error', reject);
    });
}

function parseCxfNodes(jsonText: string): CxfParsedNode[] {
    let doc: Record<string, unknown>;
    try {
        doc = JSON.parse(jsonText);
    } catch {
        return [];
    }

    const graph = doc['@graph'];
    if (!Array.isArray(graph)) return [];

    return graph
        .map((entry: unknown) => parseJsonLdNode(entry as Record<string, unknown>))
        .filter((n): n is CxfParsedNode => n !== null);
}

function parseJsonLdNode(entry: Record<string, unknown>): CxfParsedNode | null {
    const id = entry['@id'] as string | undefined;
    if (!id) return null;

    // @id format: urn:cxf:{vaultId}:{entityId}
    const urnParts = id.startsWith('urn:cxf:') ? id.slice('urn:cxf:'.length) : id;
    const colonIdx = urnParts.indexOf(':');
    const vaultId = colonIdx >= 0 ? urnParts.slice(0, colonIdx) : '';
    const entityId = colonIdx >= 0 ? urnParts.slice(colonIdx + 1) : urnParts;

    const node: CxfParsedNode = {
        uid: id,
        entityId,
        vaultId,
        type: String(entry['cxf:nativeType'] ?? ''),
        title: String(entry['schema:name'] ?? ''),
        tags: [],
        archived: entry['cxf:archived'] === true,
        deleted: entry['cxf:deleted'] === true,
        fields: {},
        links: [],
    };

    if (entry['cxf:status']) node.status = String(entry['cxf:status']);

    const keywords = entry['schema:keywords'];
    if (Array.isArray(keywords)) node.tags = keywords.map(String);

    if (entry['schema:dateCreated']) node.created = String(entry['schema:dateCreated']);
    if (entry['schema:dateModified']) node.updated = String(entry['schema:dateModified']);

    const customFields = entry['cxf:fields'];
    if (customFields && typeof customFields === 'object') {
        for (const [k, v] of Object.entries(customFields as Record<string, unknown>)) {
            if (v !== null && v !== undefined) {
                node.fields[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
            }
        }
    }

    const cxfLinks = entry['cxf:links'];
    if (Array.isArray(cxfLinks)) {
        for (const l of cxfLinks as Record<string, unknown>[]) {
            const label = l['cxf:label'];
            const target = l['cxf:target'];
            if (label && target) {
                node.links.push({ label: String(label), target: String(target) });
            }
        }
    }

    return node;
}
