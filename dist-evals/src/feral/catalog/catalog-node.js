// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Catalog Node
// ─────────────────────────────────────────────────────────────────────────────
export function createCatalogNode(props) {
    return {
        key: props.key,
        nodeCodeKey: props.nodeCodeKey,
        name: props.name ?? '',
        group: props.group ?? 'Ungrouped',
        description: props.description ?? '',
        configuration: props.configuration ?? {},
    };
}
