/**
 * Barrel export for all eval scenarios.
 */
import type { EvalScenario } from '../types.js';
import { entityTypeScenarios } from './entity-type.js';
import { createVsUpdateScenarios } from './create-vs-update.js';
import { multiEntityScenarios } from './multi-entity.js';
import { conversationalScenarios } from './conversational.js';

export const CORE_SCENARIOS: EvalScenario[] = [
    ...entityTypeScenarios,
    ...createVsUpdateScenarios,
    ...multiEntityScenarios,
    ...conversationalScenarios,
];

// Default export includes core scenarios only.
// Persona scenarios are loaded dynamically by run-eval.ts via --scenarios-file.
export const ALL_SCENARIOS: EvalScenario[] = [...CORE_SCENARIOS];
