import { entityTypeScenarios } from './entity-type.js';
import { createVsUpdateScenarios } from './create-vs-update.js';
import { multiEntityScenarios } from './multi-entity.js';
import { conversationalScenarios } from './conversational.js';
import { contextTypeCreationScenarios } from './context-type-creation.js';
export const CORE_SCENARIOS = [
    ...entityTypeScenarios,
    ...createVsUpdateScenarios,
    ...multiEntityScenarios,
    ...conversationalScenarios,
    ...contextTypeCreationScenarios,
];
// Default export includes core scenarios only.
// Persona scenarios are loaded dynamically by run-eval.ts via --scenarios-file.
export const ALL_SCENARIOS = [...CORE_SCENARIOS];
