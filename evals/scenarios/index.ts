/**
 * Barrel export for all eval scenarios.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { EvalScenario } from '../types.js';
import { entityTypeScenarios } from './entity-type.js';
import { createVsUpdateScenarios } from './create-vs-update.js';
import { multiEntityScenarios } from './multi-entity.js';
import { conversationalScenarios } from './conversational.js';
import { contextTypeCreationScenarios } from './context-type-creation.js';
import { execScenarios } from './exec.js';
import { familyScenarios } from './family.js';
import { parseMdEvals } from './parse-md-evals.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadSmokeScenarios(): EvalScenario[] {
    try {
        const md = readFileSync(join(__dirname, 'evals.md'), 'utf-8');
        return parseMdEvals(md);
    } catch {
        return [];
    }
}

export const CORE_SCENARIOS: EvalScenario[] = [
    ...entityTypeScenarios,
    ...createVsUpdateScenarios,
    ...multiEntityScenarios,
    ...conversationalScenarios,
    ...contextTypeCreationScenarios,
    ...loadSmokeScenarios(),
];

// The two primary product use cases — busy VP/CEO and busy parent — are
// first-class committed suites (not throwaway --scenarios-file personas).
// They include the retrieval-relevance scenarios that exercise the v2 scorer.
export const PERSONA_SCENARIOS: EvalScenario[] = [
    ...execScenarios,
    ...familyScenarios,
];

export const ALL_SCENARIOS: EvalScenario[] = [...CORE_SCENARIOS, ...PERSONA_SCENARIOS];
