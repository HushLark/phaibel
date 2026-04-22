// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — CXF Pull NodeCode
//
// Fetches CXF content from a registered system using GET {url}?since={cursor}.
// Parses the response into structured node records and stores them in context.
// Supports incremental sync via a cursor stored in context.
// ─────────────────────────────────────────────────────────────────────────────
import https from 'https';
import http from 'http';
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
import { getSystem, getCxfUrl } from '../../../cxf/cxf-systems.js';
export class CxfPullNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'system_id', name: 'System ID', description: 'CXF system ID from cxf-systems.json.', type: 'string' },
        { key: 'since_context_path', name: 'Since Context Path', description: 'Context key holding a Unix timestamp cursor. If absent, full export is fetched.', type: 'string', isOptional: true },
        { key: 'types', name: 'Types', description: 'Comma-separated type filter (e.g. task,event). Default: all.', type: 'string', isOptional: true },
        { key: 'result_context_path', name: 'Result Path', description: 'Context key to store parsed nodes. Default: cxf_nodes.', type: 'string', isOptional: true },
        { key: 'update_cursor', name: 'Update Cursor', description: 'Write new X-CXF-Export-Time back to since_context_path after pull. Default: true.', type: 'string', isOptional: true },
    ];
    static resultDescriptions = [
        { status: ResultStatus.OK, description: 'Nodes fetched and stored in context.' },
        { status: 'no_content', description: 'Response was empty or contained no nodes.' },
        { status: 'system_not_found', description: 'System ID not found in cxf-systems.json.' },
        { status: ResultStatus.ERROR, description: 'Request failed.' },
    ];
    constructor() {
        super('cxf_pull', 'CXF Pull', 'Fetch CXF content from a registered system. Supports incremental sync via a since-cursor stored in context.', NodeCodeCategory.DATA);
    }
    async process(context) {
        const systemId = this.getRequiredConfigValue('system_id');
        const sinceContextPath = this.getOptionalConfigValue('since_context_path');
        const typesFilter = this.getOptionalConfigValue('types');
        const resultPath = this.getOptionalConfigValue('result_context_path') ?? 'cxf_nodes';
        const updateCursor = this.getOptionalConfigValue('update_cursor') !== 'false';
        const system = await getSystem(systemId);
        if (!system) {
            return this.result('system_not_found', `CXF system "${systemId}" not found in registry.`);
        }
        try {
            const baseUrl = getCxfUrl(system);
            const params = new URLSearchParams({ consumer: systemId });
            if (typesFilter)
                params.set('types', typesFilter);
            const sinceVal = sinceContextPath ? context.get(sinceContextPath) : null;
            if (sinceVal)
                params.set('since', String(sinceVal));
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
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return this.result(ResultStatus.ERROR, `CXF pull failed: ${msg}`);
        }
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function fetchWithHeaders(url) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        lib.get(url, (res) => {
            const exportTimeHeader = res.headers['x-cxf-export-time'];
            const exportTime = exportTimeHeader ? parseInt(String(exportTimeHeader), 10) : null;
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf-8'), exportTime }));
            res.on('error', reject);
        }).on('error', reject);
    });
}
function parseCxfNodes(cxfText) {
    const nodes = [];
    // Unfold continuation lines
    const unfolded = cxfText.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
    const componentTypes = ['VTODO', 'VEVENT', 'VJOURNAL', 'VCONTEXT'];
    for (const compType of componentTypes) {
        const blocks = unfolded.split(`BEGIN:${compType}`);
        for (let i = 1; i < blocks.length; i++) {
            const block = blocks[i].split(`END:${compType}`)[0];
            const node = parseComponent(block, compType);
            if (node)
                nodes.push(node);
        }
    }
    return nodes;
}
function parseComponent(block, _compType) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    const node = {
        uid: '', entityId: '', vaultId: '', type: '', title: '',
        tags: [], archived: false, deleted: false, fields: {}, links: [],
    };
    for (const line of lines) {
        if (line.startsWith('UID:')) {
            node.uid = line.slice(4);
            const atIdx = node.uid.lastIndexOf('@');
            if (atIdx >= 0) {
                node.entityId = node.uid.slice(0, atIdx);
                node.vaultId = node.uid.slice(atIdx + 1);
            }
            else {
                node.entityId = node.uid;
            }
        }
        else if (line.startsWith('SUMMARY:')) {
            node.title = line.slice(8);
        }
        else if (line.startsWith('STATUS:')) {
            node.status = line.slice(7);
        }
        else if (line.startsWith('CATEGORIES:')) {
            node.tags = line.slice(11).split(',').map(t => t.trim()).filter(Boolean);
        }
        else if (line.startsWith('CREATED:')) {
            node.created = line.slice(8);
        }
        else if (line.startsWith('LAST-MODIFIED:')) {
            node.updated = line.slice(14);
        }
        else if (line.startsWith('X-CXF-TYPE:')) {
            node.type = line.slice(11);
        }
        else if (line.startsWith('X-CXF-ARCHIVED:TRUE')) {
            node.archived = true;
        }
        else if (line.startsWith('X-CXF-DELETED:TRUE')) {
            node.deleted = true;
        }
        else if (line.startsWith('X-CXF-FIELD-')) {
            const rest = line.slice('X-CXF-FIELD-'.length);
            const colonIdx = rest.indexOf(':');
            if (colonIdx >= 0) {
                node.fields[rest.slice(0, colonIdx).toLowerCase()] = rest.slice(colonIdx + 1);
            }
        }
        else if (line.startsWith('X-CXF-LINK;')) {
            const link = parseLinkLine(line);
            if (link)
                node.links.push(link);
        }
    }
    if (!node.uid)
        return null;
    return node;
}
function parseLinkLine(line) {
    // X-CXF-LINK;LABEL=relates-to;EDGE=link:goal-abc@vault-id
    const rest = line.slice('X-CXF-LINK;'.length);
    const colonIdx = rest.indexOf(':');
    if (colonIdx < 0)
        return null;
    const params = rest.slice(0, colonIdx);
    const target = rest.slice(colonIdx + 1);
    const paramMap = {};
    for (const p of params.split(';')) {
        const eqIdx = p.indexOf('=');
        if (eqIdx >= 0)
            paramMap[p.slice(0, eqIdx)] = p.slice(eqIdx + 1);
    }
    return { target, label: paramMap.LABEL ?? 'link' };
}
