// ─────────────────────────────────────────────────────────────────────────────
// Platform Abstraction — Type Definitions
// ─────────────────────────────────────────────────────────────────────────────
//
// These interfaces decouple the Phaibel core from Node.js-specific APIs
// (fs, path, os, crypto) so the same code can run on:
//   - Node.js (CLI + service daemon)
//   - React Native (iOS app)
//
// Each platform provides its own implementation via setPlatform().
// ─────────────────────────────────────────────────────────────────────────────
export {};
