/**
 * Phaibel Evaluation Harness — Assertion System
 *
 * Evaluates assertions against before/after vault snapshots and response text.
 *
 * Every assertion measures one or both quality dimensions:
 *   accuracy     — nothing wrong was done or said (commission failures)
 *   completeness — everything asked for was done (omission failures)
 *
 * Bidirectional checks classify their failure at evaluation time:
 *   entity_count  over → accuracy, under → completeness
 *   entity_field  wrong value → accuracy, missing → completeness
 * A per-assertion `dimension` override forces both the relevance and the
 * failure classification to a single dimension.
 */
import { getModelForCapability } from '../src/llm/router.js';
import { parseJsonResponse } from '../src/utils/json-parser.js';
import { recordUsage } from '../src/llm/token-usage.js';

// ── Judge LLM access ─────────────────────────────────────────────────────────
// The judge is pinned to an explicit model (cross-family from the engine under
// test) and invoked through Synaptic's direct-model endpoint as the eval-harness
// agent — never through the app's capability routing, so re-assigning the app's
// models can't silently change the judge.
const JUDGE_MODEL_DEFAULT = 'gpt-5.4';

function judgeModel(): string {
    return process.env.PHAIBEL_EVAL_JUDGE_MODEL ?? JUDGE_MODEL_DEFAULT;
}

async function judgeChat(prompt: string): Promise<string> {
    const key = process.env.PHAIBEL_SYNAPTIC_API_KEY;
    if (!key) {
        // No agent credentials — fall back to the app's reason capability
        const llm = await getModelForCapability('reason');
        return llm.chat([{ role: 'user', content: prompt }], { maxTokens: 2000, temperature: 0 });
    }
    const endpoint = process.env.PHAIBEL_SYNAPTIC_ENDPOINT ?? 'https://synaptic.hushlark.ai';
    const res = await fetch(`${endpoint}/v1/phaibel/llm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
            model: judgeModel(),
            max_tokens: 2000,
            temperature: 0,
            messages: [{ role: 'user', content: prompt }],
        }),
    });
    if (!res.ok) throw new Error(`Judge LLM error (${res.status}): ${await res.text()}`);
    const data = await res.json() as Record<string, unknown>;
    // Feed the harness token tracker so judge spend shows up in harness metrics
    const usage = data.usage as Record<string, number> | undefined;
    if (usage) {
        const inTok = usage.input_tokens ?? usage.prompt_tokens ?? 0;
        const outTok = usage.output_tokens ?? usage.completion_tokens ?? 0;
        if (inTok || outTok) recordUsage(judgeModel(), inTok, outTok).catch(() => {});
    }
    const content = data.content as Array<{ text?: string }> | undefined;
    if (content?.[0]?.text) return content[0].text;
    const choices = data.choices as Array<{ message: { content: string } }> | undefined;
    if (choices?.[0]?.message?.content) return choices[0].message.content;
    throw new Error('Unexpected judge response format');
}
import type {
    EvalAssertion,
    EvalDimension,
    AssertionResult,
    VaultSnapshot,
    SnapshotEntity,
} from './types.js';

const BOTH: EvalDimension[] = ['accuracy', 'completeness'];

/**
 * Run all assertions against the vault snapshots and response text.
 * Returns an AssertionResult for each assertion.
 */
export async function evaluateAssertions(
    assertions: EvalAssertion[],
    before: VaultSnapshot,
    after: VaultSnapshot,
    responseText: string,
): Promise<AssertionResult[]> {
    const results: AssertionResult[] = [];
    for (const a of assertions) {
        let result: AssertionResult;
        try {
            result = await checkAssertion(a, before, after, responseText);
        } catch (err) {
            // A thrown assertion counts against BOTH dimensions (no failedDimension).
            result = {
                description: a.description,
                type: a.type,
                passed: false,
                dimensions: BOTH,
                message: `Assertion threw: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
        // Author override: pin relevance and failure to a single dimension.
        if (a.dimension) {
            result.dimensions = [a.dimension];
            result.failedDimension = result.passed ? undefined : a.dimension;
        }
        results.push(result);
    }
    return results;
}

/**
 * Compute a weighted score from assertion results.
 * Returns 0.0–1.0.
 */
export function computeScore(assertions: EvalAssertion[], results: AssertionResult[]): number {
    let totalWeight = 0;
    let passedWeight = 0;
    for (let i = 0; i < assertions.length; i++) {
        const weight = assertions[i].weight ?? 1;
        totalWeight += weight;
        passedWeight += weight * (results[i].passed ? 1 : (results[i].score ?? 0));
    }
    return totalWeight > 0 ? passedWeight / totalWeight : 1;
}

/**
 * Compute the two dimension scores (each 0.0–1.0) from assertion results.
 *
 * For each dimension D, over assertions whose `dimensions` include D:
 *   - a pass credits full weight
 *   - a failure classified into D credits weight × fractional score (0 for binary checks)
 *   - a failure classified into the OTHER dimension credits full weight
 *     (that failure is not D's fault)
 *   - a failure with no classification (hard error) debits both dimensions
 * A dimension with no relevant assertions scores 1.0.
 */
export function computeDimensionScores(
    assertions: EvalAssertion[],
    results: AssertionResult[],
): { accuracy: number; completeness: number } {
    const scoreFor = (dim: EvalDimension): number => {
        let denom = 0;
        let credit = 0;
        for (let i = 0; i < assertions.length; i++) {
            const r = results[i];
            if (!r.dimensions.includes(dim)) continue;
            const weight = assertions[i].weight ?? 1;
            denom += weight;
            if (r.passed) {
                credit += weight;
            } else if (!r.failedDimension || r.failedDimension === dim) {
                credit += weight * (r.score ?? 0);
            } else {
                credit += weight; // failed the other dimension; not this one's fault
            }
        }
        return denom > 0 ? credit / denom : 1;
    };
    return { accuracy: scoreFor('accuracy'), completeness: scoreFor('completeness') };
}

// ─────────────────────────────────────────────────────────────────────────────
// ASSERTION CHECKERS
// ─────────────────────────────────────────────────────────────────────────────

async function checkAssertion(
    a: EvalAssertion,
    before: VaultSnapshot,
    after: VaultSnapshot,
    responseText: string,
): Promise<AssertionResult> {
    switch (a.type) {
        case 'entity_created': return checkEntityCreated(a, before, after);
        case 'entity_updated': return checkEntityUpdated(a, before, after);
        case 'entity_type_correct': return checkEntityTypeCorrect(a, after);
        case 'entity_field': return checkEntityField(a, after);
        case 'entity_not_created': return checkEntityNotCreated(a, before, after);
        case 'entity_count': return checkEntityCount(a, after);
        case 'response_contains': return checkResponseContains(a, responseText);
        case 'response_not_contains': return checkResponseNotContains(a, responseText);
        case 'context_type_created': return checkContextTypeCreated(a, after);
        case 'entity_body': return checkEntityBody(a, after);
        case 'response_faithful': return checkResponseFaithful(a, after, responseText);
    }
}

function titleMatches(entity: SnapshotEntity, pattern: string): boolean {
    return entity.title.toLowerCase().includes(pattern.toLowerCase());
}

function newEntities(before: VaultSnapshot, after: VaultSnapshot, entityType: string): SnapshotEntity[] {
    const beforeTitles = new Set((before[entityType] ?? []).map(e => e.title));
    return (after[entityType] ?? []).filter(e => !beforeTitles.has(e.title));
}

function checkEntityCreated(
    a: { type: 'entity_created'; entityType: string; titleMatch: string; description: string },
    before: VaultSnapshot,
    after: VaultSnapshot,
): AssertionResult {
    const dimensions: EvalDimension[] = ['completeness'];
    const created = newEntities(before, after, a.entityType);
    const match = created.find(e => titleMatches(e, a.titleMatch));
    if (match) {
        return { description: a.description, type: a.type, passed: true, dimensions, actual: match.title, message: `Created ${a.entityType}: "${match.title}"` };
    }
    const allNew = created.map(e => e.title);
    return { description: a.description, type: a.type, passed: false, dimensions, failedDimension: 'completeness', actual: allNew, message: `No new ${a.entityType} matching "${a.titleMatch}". New: [${allNew.join(', ')}]` };
}

function checkEntityUpdated(
    a: { type: 'entity_updated'; entityType: string; titleMatch: string; description: string },
    before: VaultSnapshot,
    after: VaultSnapshot,
): AssertionResult {
    const dimensions = BOTH;
    const beforeEntity = (before[a.entityType] ?? []).find(e => titleMatches(e, a.titleMatch));
    const afterEntity = (after[a.entityType] ?? []).find(e => titleMatches(e, a.titleMatch));
    if (!beforeEntity) {
        return { description: a.description, type: a.type, passed: false, dimensions, failedDimension: 'completeness', message: `No pre-existing ${a.entityType} matching "${a.titleMatch}"` };
    }
    if (!afterEntity) {
        // The entity was destroyed — an incorrect write, not an omission.
        return { description: a.description, type: a.type, passed: false, dimensions, failedDimension: 'accuracy', message: `${a.entityType} matching "${a.titleMatch}" was deleted` };
    }
    const beforeUpdated = beforeEntity.meta.updated;
    const afterUpdated = afterEntity.meta.updated;
    // Check timestamp change OR any field value change
    if (afterUpdated !== beforeUpdated) {
        return { description: a.description, type: a.type, passed: true, dimensions, message: `${a.entityType} "${afterEntity.title}" was updated (timestamp changed)` };
    }
    // Fallback: check if any metadata field actually changed
    for (const key of Object.keys(afterEntity.meta)) {
        if (key === '_filepath') continue;
        if (JSON.stringify(afterEntity.meta[key]) !== JSON.stringify(beforeEntity.meta[key])) {
            return { description: a.description, type: a.type, passed: true, dimensions, message: `${a.entityType} "${afterEntity.title}" was updated (field "${key}" changed)` };
        }
    }
    // Also check body content
    if (afterEntity.body !== beforeEntity.body) {
        return { description: a.description, type: a.type, passed: true, dimensions, message: `${a.entityType} "${afterEntity.title}" was updated (body changed)` };
    }
    return { description: a.description, type: a.type, passed: false, dimensions, failedDimension: 'completeness', message: `${a.entityType} "${afterEntity.title}" was NOT updated (no changes detected)` };
}

function checkEntityTypeCorrect(
    a: { type: 'entity_type_correct'; titleMatch: string; expectedType: string; wrongTypes?: string[]; description: string },
    after: VaultSnapshot,
): AssertionResult {
    const dimensions = BOTH;
    // Check it exists under the expected type
    const inExpected = (after[a.expectedType] ?? []).find(e => titleMatches(e, a.titleMatch));
    if (!inExpected) {
        // Search all types to report where it ended up
        for (const [type, entities] of Object.entries(after)) {
            const found = entities.find(e => titleMatches(e, a.titleMatch));
            if (found) {
                // Written under the wrong type — an incorrect write.
                return { description: a.description, type: a.type, passed: false, dimensions, failedDimension: 'accuracy', actual: type, message: `"${a.titleMatch}" found as ${type}, expected ${a.expectedType}` };
            }
        }
        // Not written anywhere — the work was omitted.
        return { description: a.description, type: a.type, passed: false, dimensions, failedDimension: 'completeness', message: `"${a.titleMatch}" not found in any entity type` };
    }

    // Check it's not in wrong types
    if (a.wrongTypes) {
        for (const wt of a.wrongTypes) {
            const inWrong = (after[wt] ?? []).find(e => titleMatches(e, a.titleMatch));
            if (inWrong) {
                return { description: a.description, type: a.type, passed: false, dimensions, failedDimension: 'accuracy', actual: wt, message: `"${a.titleMatch}" also found as ${wt} (should only be ${a.expectedType})` };
            }
        }
    }

    return { description: a.description, type: a.type, passed: true, dimensions, actual: a.expectedType, message: `"${a.titleMatch}" correctly created as ${a.expectedType}` };
}

function checkEntityField(
    a: { type: 'entity_field'; entityType: string; titleMatch: string; field: string; expected: unknown; description: string },
    after: VaultSnapshot,
): AssertionResult {
    const dimensions = BOTH;
    const entity = (after[a.entityType] ?? []).find(e => titleMatches(e, a.titleMatch));
    if (!entity) {
        return { description: a.description, type: a.type, passed: false, dimensions, failedDimension: 'completeness', message: `No ${a.entityType} matching "${a.titleMatch}" found` };
    }
    const actual = entity.meta[a.field];
    if (typeof a.expected === 'string' && typeof actual === 'string') {
        if (actual.toLowerCase().includes(a.expected.toLowerCase())) {
            return { description: a.description, type: a.type, passed: true, dimensions, actual, message: `${a.field} = "${actual}" contains "${a.expected}"` };
        }
    }
    if (actual === a.expected) {
        return { description: a.description, type: a.type, passed: true, dimensions, actual, message: `${a.field} = ${JSON.stringify(actual)}` };
    }
    // Field never written → omission; written with the wrong value → commission.
    const failedDimension: EvalDimension = actual === undefined || actual === null ? 'completeness' : 'accuracy';
    return { description: a.description, type: a.type, passed: false, dimensions, failedDimension, actual, message: `${a.field} = ${JSON.stringify(actual)}, expected ${JSON.stringify(a.expected)}` };
}

function checkEntityNotCreated(
    a: { type: 'entity_not_created'; entityType: string; titleMatch: string; description: string },
    before: VaultSnapshot,
    after: VaultSnapshot,
): AssertionResult {
    const dimensions: EvalDimension[] = ['accuracy'];
    const created = newEntities(before, after, a.entityType);
    const match = created.find(e => titleMatches(e, a.titleMatch));
    if (match) {
        return { description: a.description, type: a.type, passed: false, dimensions, failedDimension: 'accuracy', actual: match.title, message: `Unwanted ${a.entityType} was created: "${match.title}"` };
    }
    return { description: a.description, type: a.type, passed: true, dimensions, message: `No unwanted ${a.entityType} matching "${a.titleMatch}" was created` };
}

function checkEntityCount(
    a: { type: 'entity_count'; entityType: string; expected: number; description: string },
    after: VaultSnapshot,
): AssertionResult {
    const dimensions = BOTH;
    const count = (after[a.entityType] ?? []).length;
    if (count === a.expected) {
        return { description: a.description, type: a.type, passed: true, dimensions, actual: count, message: `${a.entityType} count = ${count}` };
    }
    // Too many → duplicates/unwanted writes (accuracy); too few → missed work (completeness).
    const failedDimension: EvalDimension = count > a.expected ? 'accuracy' : 'completeness';
    return { description: a.description, type: a.type, passed: false, dimensions, failedDimension, actual: count, message: `${a.entityType} count = ${count}, expected ${a.expected}` };
}

function checkContextTypeCreated(
    a: { type: 'context_type_created'; typeName: string; description: string },
    after: VaultSnapshot,
): AssertionResult {
    const dimensions: EvalDimension[] = ['completeness'];
    // A context type is "created" if it has an entry in the snapshot (even if empty)
    if (a.typeName in after) {
        return { description: a.description, type: a.type, passed: true, dimensions, message: `Context type "${a.typeName}" was created` };
    }
    const available = Object.keys(after).join(', ');
    return { description: a.description, type: a.type, passed: false, dimensions, failedDimension: 'completeness', message: `Context type "${a.typeName}" not found. Available: [${available}]` };
}

function checkEntityBody(
    a: { type: 'entity_body'; entityType: string; titleMatch: string; match: string; description: string },
    after: VaultSnapshot,
): AssertionResult {
    const dimensions: EvalDimension[] = ['completeness'];
    const entity = (after[a.entityType] ?? []).find(e => titleMatches(e, a.titleMatch));
    if (!entity) {
        return { description: a.description, type: a.type, passed: false, dimensions, failedDimension: 'completeness', message: `No ${a.entityType} matching "${a.titleMatch}" found` };
    }
    if (entity.body.toLowerCase().includes(a.match.toLowerCase())) {
        return { description: a.description, type: a.type, passed: true, dimensions, message: `Body contains "${a.match}"` };
    }
    return { description: a.description, type: a.type, passed: false, dimensions, failedDimension: 'completeness', actual: entity.body.slice(0, 200), message: `Body does not contain "${a.match}"` };
}

function checkResponseContains(
    a: { type: 'response_contains'; match: string; description: string },
    responseText: string,
): AssertionResult {
    const dimensions: EvalDimension[] = ['completeness'];
    if (responseText.toLowerCase().includes(a.match.toLowerCase())) {
        return { description: a.description, type: a.type, passed: true, dimensions, message: `Response contains "${a.match}"` };
    }
    return { description: a.description, type: a.type, passed: false, dimensions, failedDimension: 'completeness', actual: responseText.slice(0, 200), message: `Response does not contain "${a.match}"` };
}

function checkResponseNotContains(
    a: { type: 'response_not_contains'; match: string; description: string },
    responseText: string,
): AssertionResult {
    const dimensions: EvalDimension[] = ['accuracy'];
    if (!responseText.toLowerCase().includes(a.match.toLowerCase())) {
        return { description: a.description, type: a.type, passed: true, dimensions, message: `Response correctly omits "${a.match}"` };
    }
    return { description: a.description, type: a.type, passed: false, dimensions, failedDimension: 'accuracy', actual: responseText.slice(0, 200), message: `Response unexpectedly contains "${a.match}" (distractor surfaced)` };
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM-JUDGED FAITHFULNESS
// ─────────────────────────────────────────────────────────────────────────────

interface JudgedClaim {
    claim: string;
    verdict: 'supported' | 'unsupported' | 'contradicted';
    reason?: string;
}

/**
 * Judge every factual claim in the response against the post-run vault
 * contents plus optional scenario-provided ground truth. Fractional credit:
 * score = supported / total claims. Counts against accuracy — a fluent,
 * wrong answer is a commission failure even when all writes were correct.
 */
async function checkResponseFaithful(
    a: { type: 'response_faithful'; groundTruth?: string; description: string },
    after: VaultSnapshot,
    responseText: string,
): Promise<AssertionResult> {
    const dimensions: EvalDimension[] = ['accuracy'];

    const vaultFacts = Object.entries(after)
        .flatMap(([type, entities]) => entities.map(e => {
            const meta = JSON.stringify(e.meta);
            const body = e.body ? ` | ${e.body.slice(0, 300)}` : '';
            return `- [${type}] "${e.title}" ${meta}${body}`;
        }))
        .join('\n') || '(vault is empty)';

    const prompt = [
        'You are a strict fact-checker for an AI assistant evaluation.',
        'Extract every verifiable factual claim from the RESPONSE and judge it against the GROUND TRUTH.',
        'Ignore pleasantries, offers of help, and questions — only claims that assert something checkable.',
        'A claim is "supported" if the ground truth entails it, "contradicted" if the ground truth conflicts with it,',
        'and "unsupported" if it asserts something the ground truth is silent on.',
        '',
        '## GROUND TRUTH',
        '### Vault contents after the interaction:',
        vaultFacts,
        ...(a.groundTruth ? ['### Additional facts:', a.groundTruth] : []),
        '',
        '## RESPONSE',
        responseText,
        '',
        'Reply with ONLY a JSON object: {"claims": [{"claim": string, "verdict": "supported"|"unsupported"|"contradicted", "reason": string}]}',
        'Keep each claim and reason under 15 words. No prose outside the JSON.',
    ].join('\n');

    let claims: JudgedClaim[] = [];
    let lastErr: unknown;
    // The judge occasionally truncates or malforms JSON — one retry before giving up.
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const raw = await judgeChat(prompt);
            const parsed = parseJsonResponse(raw) as { claims?: JudgedClaim[] } | null;
            claims = parsed?.claims ?? [];
            lastErr = undefined;
            break;
        } catch (err) {
            lastErr = err;
        }
    }
    if (lastErr) {
        // Judge unavailable/unparseable — report as a failed check rather than throwing,
        // so the scenario records a judge outage instead of debiting both dimensions.
        return {
            description: a.description, type: a.type, passed: false, score: 0, dimensions,
            failedDimension: 'accuracy',
            message: `Judge failed after retry: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
        };
    }

    if (claims.length === 0) {
        return { description: a.description, type: a.type, passed: true, score: 1, dimensions, message: `No verifiable claims in response [judge=${judgeModel()}]` };
    }

    const supported = claims.filter(c => c.verdict === 'supported').length;
    const score = supported / claims.length;
    const bad = claims.filter(c => c.verdict !== 'supported');

    if (bad.length === 0) {
        return { description: a.description, type: a.type, passed: true, score: 1, dimensions, actual: claims.length, message: `All ${claims.length} claim(s) supported [judge=${judgeModel()}]` };
    }
    return {
        description: a.description,
        type: a.type,
        passed: false,
        score,
        dimensions,
        failedDimension: 'accuracy',
        actual: bad.map(c => `${c.verdict}: ${c.claim}`),
        message: `${supported}/${claims.length} claims supported [judge=${judgeModel()}]. Problems: ${bad.map(c => `[${c.verdict}] "${c.claim}"`).join('; ')}`,
    };
}
