/**
 * Phaibel Evaluation Harness — Type Definitions
 */

import type { ChatHistoryEntry } from '../src/commands/chat.js';

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO DEFINITION
// ─────────────────────────────────────────────────────────────────────────────

export interface VaultSeedEntity {
    entityType: string;
    title: string;
    fields?: Record<string, unknown>;
    body?: string;
}

export interface EvalScenario {
    id: string;
    name: string;
    category: 'entity-type' | 'create-vs-update' | 'multi-entity' | 'conversational' | 'persona' | 'context-type-creation' | 'cxms-mutation' | 'smoke' | 'semantic-stress';
    userInput: string;
    history?: ChatHistoryEntry[];
    vaultSeed?: VaultSeedEntity[];
    assertions: EvalAssertion[];
    timeoutSeconds?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// ASSERTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The two quality dimensions every assertion measures:
 * - accuracy:     nothing wrong was done or said (no incorrect writes, no false reads/claims)
 * - completeness: everything asked for was done (no omitted work, no missing info)
 * Failures are classified by direction: commission → accuracy, omission → completeness.
 */
export type EvalDimension = 'accuracy' | 'completeness';

interface BaseAssertion {
    weight?: number;
    description: string;
    /**
     * Override the automatic failure-mode classification. Most assertions
     * classify themselves (e.g. entity_not_created failures are accuracy;
     * entity_created failures are completeness; entity_count is bidirectional).
     * Set this only when the default reading is wrong for a specific check.
     */
    dimension?: EvalDimension;
}

export interface EntityCreatedAssertion extends BaseAssertion {
    type: 'entity_created';
    entityType: string;
    titleMatch: string;
}

export interface EntityUpdatedAssertion extends BaseAssertion {
    type: 'entity_updated';
    entityType: string;
    titleMatch: string;
}

export interface EntityTypeCorrectAssertion extends BaseAssertion {
    type: 'entity_type_correct';
    titleMatch: string;
    expectedType: string;
    wrongTypes?: string[];
}

export interface EntityFieldAssertion extends BaseAssertion {
    type: 'entity_field';
    entityType: string;
    titleMatch: string;
    field: string;
    expected: unknown;
}

export interface EntityNotCreatedAssertion extends BaseAssertion {
    type: 'entity_not_created';
    entityType: string;
    titleMatch: string;
}

export interface EntityCountAssertion extends BaseAssertion {
    type: 'entity_count';
    entityType: string;
    expected: number;
}

export interface ResponseContainsAssertion extends BaseAssertion {
    type: 'response_contains';
    match: string;
}

export interface ResponseNotContainsAssertion extends BaseAssertion {
    type: 'response_not_contains';
    /** Substring (case-insensitive) that must NOT appear — e.g. a distractor entity surfaced by poor ranking */
    match: string;
}

export interface ContextTypeCreatedAssertion extends BaseAssertion {
    type: 'context_type_created';
    typeName: string;
}

export interface EntityBodyAssertion extends BaseAssertion {
    type: 'entity_body';
    entityType: string;
    titleMatch: string;
    match: string;
}

export interface ResponseFaithfulAssertion extends BaseAssertion {
    type: 'response_faithful';
    /**
     * Extra ground-truth facts (beyond the post-run vault contents) that the
     * response's claims are judged against. An LLM judge extracts each factual
     * claim from the response and scores supported/total — fractional credit,
     * counted against accuracy.
     */
    groundTruth?: string;
}

export type EvalAssertion =
    | EntityCreatedAssertion
    | EntityUpdatedAssertion
    | EntityTypeCorrectAssertion
    | EntityFieldAssertion
    | EntityNotCreatedAssertion
    | EntityCountAssertion
    | ResponseContainsAssertion
    | ResponseNotContainsAssertion
    | EntityBodyAssertion
    | ContextTypeCreatedAssertion
    | ResponseFaithfulAssertion;

// ─────────────────────────────────────────────────────────────────────────────
// RESULTS
// ─────────────────────────────────────────────────────────────────────────────

export interface AssertionResult {
    description: string;
    type: string;
    passed: boolean;
    /** Fractional credit 0–1 for judged assertions (e.g. response_faithful). Binary checks omit it (passed ⇒ 1, failed ⇒ 0). */
    score?: number;
    /** Dimensions this assertion is capable of measuring. */
    dimensions: EvalDimension[];
    /** On failure: the dimension the failure counts against. Absent on hard errors (counts against both). */
    failedDimension?: EvalDimension;
    actual?: unknown;
    message: string;
}

/**
 * Time and spend for one side of the app/harness split.
 * - app:     the engine under test (the feralChatHeadless call — its wall-clock
 *            and its LLM calls). Judge the APPLICATION on these numbers only.
 * - harness: eval overhead (vault setup/teardown, snapshots, assertion checks
 *            including the response_faithful judge). Never attribute these to
 *            the application.
 */
export interface RunMetrics {
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    llmCalls: number;
}

export interface ScenarioResult {
    scenarioId: string;
    scenarioName: string;
    category: string;
    passed: boolean;
    score: number;
    /** 0–1: weighted share of accuracy-relevant checks with nothing wrong done or said. */
    accuracy: number;
    /** 0–1: weighted share of completeness-relevant checks with everything asked for done. */
    completeness: number;
    /** Engine-under-test time/spend — the basis for application judgments. */
    app: RunMetrics;
    /** Eval-overhead time/spend (incl. LLM judge) — excluded from application judgments. */
    harness: RunMetrics;
    assertionResults: AssertionResult[];
    responseText: string;
    /** Total wall-clock (app + harness). */
    durationMs: number;
    error?: string;
}

export interface EvalSummary {
    totalScenarios: number;
    passed: number;
    failed: number;
    overallScore: number;
    overallAccuracy: number;
    overallCompleteness: number;
    /** Summed engine-under-test metrics — the basis for application judgments. */
    appTotals: RunMetrics;
    /** Summed eval-overhead metrics — kept separate; never judge the app on these. */
    harnessTotals: RunMetrics;
    byCategory: Record<string, { total: number; passed: number; score: number; accuracy: number; completeness: number; appDurationMs: number; appCostUsd: number }>;
}

export interface EvalRunConfig {
    label: string;
    gitCommit?: string;
    scenarioFilter?: string[];
    /** Pipeline (engine) key the chat host runs — e.g. pipeline.standard, pipeline.cruel-summer, pipeline.hertz. */
    engine?: string;
    /** Mobile-emulation mode: platform:'mobile' bootstrap, synaptic-only providers, no local embeddings. */
    mobile?: boolean;
    modelOverrides?: Record<string, { provider: string; model: string }>;
}

export interface EvalRunResult {
    runId: string;
    timestamp: string;
    config: EvalRunConfig;
    scenarios: ScenarioResult[];
    summary: EvalSummary;
}

// ─────────────────────────────────────────────────────────────────────────────
// VAULT SNAPSHOT
// ─────────────────────────────────────────────────────────────────────────────

export interface SnapshotEntity {
    title: string;
    meta: Record<string, unknown>;
    body: string;
}

export type VaultSnapshot = Record<string, SnapshotEntity[]>;
