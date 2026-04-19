// ─────────────────────────────────────────────────────────────────────────────
// Federation — Barrel export for the Federated Context Protocol (FCP).
// ─────────────────────────────────────────────────────────────────────────────

export * from './fcp-types.js';
export {
    probeSource, fetchFromSource, getManifest, FcpError,
    listRemoteTypes, createRemoteNode, updateRemoteNode, deleteRemoteNode,
} from './fcp-client.js';
export {
    probeAll, fetchAll,
    type FederatedRelevance, type FederatedSourceResult,
    type FederatedFetchRequest, type FederatedFetchResult,
} from './federator.js';
export {
    loadSourceRegistry, saveSourceRegistry,
    addSource, removeSource, getEnabledSources, getReadWriteSources,
} from './source-registry.js';
export { handleFcpRoute } from './fcp-server.js';
