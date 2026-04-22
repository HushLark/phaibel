// ─────────────────────────────────────────────────────────────────────────────
// FCP Source Registry — load/save the list of remote context sources.
// Stored at {vault}/.phaibel/fcp-sources.json.
// ─────────────────────────────────────────────────────────────────────────────
import { getPlatform } from '../platform/index.js';
import { getVaultConfigDir } from '../paths.js';
import { SourceRegistrySchema } from './fcp-types.js';
import { debug } from '../utils/debug.js';
const DEFAULT_REGISTRY = { sources: [] };
async function registryPath() {
    const dir = await getVaultConfigDir();
    return getPlatform().paths.join(dir, 'fcp-sources.json');
}
export async function loadSourceRegistry() {
    try {
        const raw = await getPlatform().storage.readFile(await registryPath());
        return SourceRegistrySchema.parse(JSON.parse(raw));
    }
    catch (err) {
        debug('fcp', `no source registry: ${err instanceof Error ? err.message : err}`);
        return DEFAULT_REGISTRY;
    }
}
export async function saveSourceRegistry(registry) {
    const { storage } = getPlatform();
    const dir = await getVaultConfigDir();
    await storage.mkdir(dir, { recursive: true });
    await storage.writeFile(await registryPath(), JSON.stringify(registry, null, 2));
}
export async function addSource(source) {
    const reg = await loadSourceRegistry();
    const idx = reg.sources.findIndex(s => s.id === source.id);
    if (idx >= 0)
        reg.sources[idx] = source;
    else
        reg.sources.push(source);
    await saveSourceRegistry(reg);
}
export async function removeSource(id) {
    const reg = await loadSourceRegistry();
    const before = reg.sources.length;
    reg.sources = reg.sources.filter(s => s.id !== id);
    if (reg.sources.length === before)
        return false;
    await saveSourceRegistry(reg);
    return true;
}
export async function getEnabledSources() {
    const reg = await loadSourceRegistry();
    return reg.sources.filter(s => s.enabled);
}
export async function getReadWriteSources() {
    const reg = await loadSourceRegistry();
    return reg.sources.filter(s => s.enabled && s.mode === 'readwrite');
}
