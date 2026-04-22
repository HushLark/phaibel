// ─────────────────────────────────────────────────────────────────────────────
// CXF Systems Registry — list of remote CXF-compatible systems.
// Stored at {foundation}/.phaibel/cxf-systems.json.
// ─────────────────────────────────────────────────────────────────────────────
import { getPlatform } from '../platform/index.js';
import { getVaultConfigDir } from '../paths.js';
async function systemsPath() {
    const dir = await getVaultConfigDir();
    return getPlatform().paths.join(dir, 'cxf-systems.json');
}
export async function loadSystems() {
    try {
        const raw = await getPlatform().storage.readFile(await systemsPath());
        return JSON.parse(raw);
    }
    catch {
        return [];
    }
}
export async function saveSystems(systems) {
    const { storage } = getPlatform();
    const dir = await getVaultConfigDir();
    await storage.mkdir(dir, { recursive: true });
    await storage.writeFile(await systemsPath(), JSON.stringify(systems, null, 2));
}
export async function getEnabledSystems() {
    return (await loadSystems()).filter(s => s.enabled);
}
export async function getSystem(id) {
    return (await loadSystems()).find(s => s.id === id);
}
export async function addSystem(system) {
    const systems = await loadSystems();
    const idx = systems.findIndex(s => s.id === system.id);
    if (idx >= 0)
        systems[idx] = system;
    else
        systems.push(system);
    await saveSystems(systems);
}
export async function removeSystem(id) {
    const systems = await loadSystems();
    const before = systems.length;
    const filtered = systems.filter(s => s.id !== id);
    if (filtered.length === before)
        return false;
    await saveSystems(filtered);
    return true;
}
/** Resolve the CXF endpoint URL for a system. */
export function getCxfUrl(system) {
    const path = system.cxfPath ?? '/cx/cxf';
    return `${system.url.replace(/\/$/, '')}${path}`;
}
