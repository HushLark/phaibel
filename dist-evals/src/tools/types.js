// ─────────────────────────────────────────────────────────────────────────────
// Tool Registry
// ─────────────────────────────────────────────────────────────────────────────
const serviceTools = new Map();
export function registerServiceTool(tool) {
    serviceTools.set(tool.name, tool);
}
export function getServiceTool(name) {
    return serviceTools.get(name);
}
export function listServiceTools() {
    return Array.from(serviceTools.values());
}
export function hasServiceTool(name) {
    return serviceTools.has(name);
}
