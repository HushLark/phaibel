// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — CXF Catalog Source
//
// Registers catalog nodes for CXF/1 integration: discover, pull, and push.
// ─────────────────────────────────────────────────────────────────────────────
export class CxfCatalogSource {
    getCatalogNodes() {
        return [
            {
                key: 'cxf_discover',
                nodeCodeKey: 'cxf_discover',
                name: 'CXF Discover',
                group: 'integration',
                description: 'Discover the context types exposed by a remote CXF system. Parses VSCHEMA blocks and stores a type registry in context under "cxf_schema". No LLM required.',
                configuration: { result_context_path: 'cxf_schema' },
            },
            {
                key: 'cxf_pull',
                nodeCodeKey: 'cxf_pull',
                name: 'CXF Pull — Incremental',
                group: 'integration',
                description: 'Fetch CXF content from a registered system incrementally using a since-cursor stored in context. Updates the cursor after each successful pull.',
                configuration: { result_context_path: 'cxf_nodes', update_cursor: 'true' },
            },
            {
                key: 'cxf_pull_full',
                nodeCodeKey: 'cxf_pull',
                name: 'CXF Pull — Full Export',
                group: 'integration',
                description: 'Fetch a full CXF export from a registered system (no since-cursor). Use for initial load or re-sync.',
                configuration: { result_context_path: 'cxf_nodes', update_cursor: 'false' },
            },
            {
                key: 'cxf_push',
                nodeCodeKey: 'cxf_push',
                name: 'CXF Push',
                group: 'integration',
                description: 'Record a CXF sync for a named consumer and store the export URL in context. The consumer can then pull from that URL to receive updated entities.',
                configuration: { export_url_context_path: 'cxf_export_url' },
            },
        ];
    }
}
