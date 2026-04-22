// ─────────────────────────────────────────────────────────────────────────────
// Feral Agent — Render Prompt
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Renders catalog and NodeCode descriptions for LLM consumption.
 * Used by agents to provide context about available processes and nodes.
 */
export class RenderPrompt {
    /**
     * Render a text description of all catalog nodes for LLM consumption.
     */
    renderCatalogDescription(catalog) {
        const nodes = catalog.getAllCatalogNodes();
        if (nodes.length === 0) {
            return '(no catalog nodes available)';
        }
        return nodes.map(node => {
            const configKeys = Object.keys(node.configuration);
            const configStr = configKeys.length > 0
                ? ` [config: ${configKeys.join(', ')}]`
                : '';
            return `- ${node.key}: ${node.description || node.name}${configStr}`;
        }).join('\n');
    }
}
