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
    category: 'entity-type' | 'create-vs-update' | 'multi-entity' | 'conversational' | 'persona' | 'context-type-creation' | 'smoke';
    userInput: string;
    history?: ChatHistoryEntry[];
    vaultSeed?: VaultSeedEntity[];
    assertions: EvalAssertion[];
    timeoutSeconds?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// ASSERTIONS
// ─────────────────────────────────────────────────────────────────────────────

interface BaseAssertion {
    weight?: number;
    description: string;
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

export interface ContextTypeCreatedAssertion extends BaseAssertion {
    type: 'context_type_created';
    typeName: string;
}

export type EvalAssertion =
    | EntityCreatedAssertion
    | EntityUpdatedAssertion
    | EntityTypeCorrectAssertion
    | EntityFieldAssertion
    | EntityNotCreatedAssertion
    | EntityCountAssertion
    | ResponseContainsAssertion
    | ContextTypeCreatedAssertion;

// ─────────────────────────────────────────────────────────────────────────────
// RESULTS
// ─────────────────────────────────────────────────────────────────────────────

export interface AssertionResult {
    description: string;
    type: string;
    passed: boolean;
    actual?: unknown;
    message: string;
}

export interface ScenarioResult {
    scenarioId: string;
    scenarioName: string;
    category: string;
    passed: boolean;
    score: number;
    assertionResults: AssertionResult[];
    responseText: string;
    durationMs: number;
    error?: string;
}

export interface EvalSummary {
    totalScenarios: number;
    passed: number;
    failed: number;
    overallScore: number;
    byCategory: Record<string, { total: number; passed: number; score: number }>;
}

export interface EvalRunConfig {
    label: string;
    gitCommit?: string;
    scenarioFilter?: string[];
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
