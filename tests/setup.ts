// Global test setup — runs before every test file.
//
// Initialises the platform singleton so that getPlatform() never hits the
// createRequire('./node.js') path, which fails when Vitest runs from TypeScript
// source because tsx resolves import() but not createRequire.
import { createNodePlatform } from '../src/platform/node.js';
import { setPlatform } from '../src/platform/index.js';

setPlatform(createNodePlatform());
