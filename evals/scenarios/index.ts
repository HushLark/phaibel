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
import { cxmsMutationScenarios } from './cxms-mutations.js';
import { execScenarios } from './exec.js';
import { familyScenarios } from './family.js';
import { parseMdEvals } from './parse-md-evals.js';
import { semanticStressScenarios } from './semantic-stress.js';
import { peopleWorkflowScenarios } from './people-workflow.js';
import { businessWorkflowScenarios } from './business-workflow.js';
import { businessPlaceRelationshipScenarios } from './business-place-relationships.js';
import { dateScenarios } from './dates.js';

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
    ...cxmsMutationScenarios,
    ...peopleWorkflowScenarios,
    ...businessWorkflowScenarios,
    ...businessPlaceRelationshipScenarios,
    ...dateScenarios,
    ...loadSmokeScenarios(),
];

// The two primary product use cases — busy VP/CEO and busy parent — are
// first-class committed suites (not throwaway --scenarios-file personas).
// They include the retrieval-relevance scenarios that exercise the v2 scorer.
export const PERSONA_SCENARIOS: EvalScenario[] = [
    ...execScenarios,
    ...familyScenarios,
];

// Large-vault paraphrase-recall suite — decides whether platforms without
// local embeddings (mobile) need a semantic component. Kept OUT of
// ALL_SCENARIOS: 120+ seeded entities per scenario make it a targeted
// instrument, not a default regression suite.
export const SEMANTIC_STRESS_SCENARIOS: EvalScenario[] = [...semanticStressScenarios];

export const ALL_SCENARIOS: EvalScenario[] = [...CORE_SCENARIOS, ...PERSONA_SCENARIOS, ...SEMANTIC_STRESS_SCENARIOS];
