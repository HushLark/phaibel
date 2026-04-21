// ─────────────────────────────────────────────────────────────────────────────
// CXF Systems Registry — list of remote CXF-compatible systems.
// Stored at {foundation}/.phaibel/cxf-systems.json.
// ─────────────────────────────────────────────────────────────────────────────

import { getPlatform } from '../platform/index.js';
import { getVaultConfigDir } from '../paths.js';

export interface CxfSystem {
    id: string;
    name: string;
    url: string;          // Base URL, e.g. "http://localhost:3800"
    cxfPath?: string;     // Override CXF endpoint path, default "/cx/cxf"
    mode: 'read' | 'readwrite';
    enabled: boolean;
}

async function systemsPath(): Promise<string> {
    const dir = await getVaultConfigDir();
    return getPlatform().paths.join(dir, 'cxf-systems.json');
}

export async function loadSystems(): Promise<CxfSystem[]> {
    try {
        const raw = await getPlatform().storage.readFile(await systemsPath());
        return JSON.parse(raw) as CxfSystem[];
    } catch {
        return [];
    }
}

export async function saveSystems(systems: CxfSystem[]): Promise<void> {
    const { storage } = getPlatform();
    const dir = await getVaultConfigDir();
    await storage.mkdir(dir, { recursive: true });
    await storage.writeFile(await systemsPath(), JSON.stringify(systems, null, 2));
}

export async function getEnabledSystems(): Promise<CxfSystem[]> {
    return (await loadSystems()).filter(s => s.enabled);
}

export async function getSystem(id: string): Promise<CxfSystem | undefined> {
    return (await loadSystems()).find(s => s.id === id);
}

export async function addSystem(system: CxfSystem): Promise<void> {
    const systems = await loadSystems();
    const idx = systems.findIndex(s => s.id === system.id);
    if (idx >= 0) systems[idx] = system;
    else systems.push(system);
    await saveSystems(systems);
}

export async function removeSystem(id: string): Promise<boolean> {
    const systems = await loadSystems();
    const before = systems.length;
    const filtered = systems.filter(s => s.id !== id);
    if (filtered.length === before) return false;
    await saveSystems(filtered);
    return true;
}

/** Resolve the CXF endpoint URL for a system. */
export function getCxfUrl(system: CxfSystem): string {
    const path = system.cxfPath ?? '/cx/cxf';
    return `${system.url.replace(/\/$/, '')}${path}`;
}
