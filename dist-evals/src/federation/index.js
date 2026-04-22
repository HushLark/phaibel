// ─────────────────────────────────────────────────────────────────────────────
// Federation — Barrel export for the Federated Context Protocol (FCP).
// ─────────────────────────────────────────────────────────────────────────────
export * from './fcp-types.js';
export { probeSource, fetchFromSource, getManifest, FcpError, listRemoteTypes, createRemoteNode, updateRemoteNode, deleteRemoteNode, } from './fcp-client.js';
export { probeAll, fetchAll, } from './federator.js';
export { loadSourceRegistry, saveSourceRegistry, addSource, removeSource, getEnabledSources, getReadWriteSources, } from './source-registry.js';
export { handleFcpRoute } from './fcp-server.js';
