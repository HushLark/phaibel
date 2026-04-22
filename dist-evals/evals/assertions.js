/**
 * Run all assertions against the vault snapshots and response text.
 * Returns an AssertionResult for each assertion.
 */
export function evaluateAssertions(assertions, before, after, responseText) {
    return assertions.map(a => {
        try {
            return checkAssertion(a, before, after, responseText);
        }
        catch (err) {
            return {
                description: a.description,
                type: a.type,
                passed: false,
                message: `Assertion threw: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    });
}
/**
 * Compute a weighted score from assertion results.
 * Returns 0.0–1.0.
 */
export function computeScore(assertions, results) {
    let totalWeight = 0;
    let passedWeight = 0;
    for (let i = 0; i < assertions.length; i++) {
        const weight = assertions[i].weight ?? 1;
        totalWeight += weight;
        if (results[i].passed) {
            passedWeight += weight;
        }
    }
    return totalWeight > 0 ? passedWeight / totalWeight : 1;
}
// ─────────────────────────────────────────────────────────────────────────────
// ASSERTION CHECKERS
// ─────────────────────────────────────────────────────────────────────────────
function checkAssertion(a, before, after, responseText) {
    switch (a.type) {
        case 'entity_created': return checkEntityCreated(a, before, after);
        case 'entity_updated': return checkEntityUpdated(a, before, after);
        case 'entity_type_correct': return checkEntityTypeCorrect(a, after);
        case 'entity_field': return checkEntityField(a, after);
        case 'entity_not_created': return checkEntityNotCreated(a, before, after);
        case 'entity_count': return checkEntityCount(a, after);
        case 'response_contains': return checkResponseContains(a, responseText);
        case 'context_type_created': return checkContextTypeCreated(a, after);
    }
}
function titleMatches(entity, pattern) {
    return entity.title.toLowerCase().includes(pattern.toLowerCase());
}
function newEntities(before, after, entityType) {
    const beforeTitles = new Set((before[entityType] ?? []).map(e => e.title));
    return (after[entityType] ?? []).filter(e => !beforeTitles.has(e.title));
}
function checkEntityCreated(a, before, after) {
    const created = newEntities(before, after, a.entityType);
    const match = created.find(e => titleMatches(e, a.titleMatch));
    if (match) {
        return { description: a.description, type: a.type, passed: true, actual: match.title, message: `Created ${a.entityType}: "${match.title}"` };
    }
    const allNew = created.map(e => e.title);
    return { description: a.description, type: a.type, passed: false, actual: allNew, message: `No new ${a.entityType} matching "${a.titleMatch}". New: [${allNew.join(', ')}]` };
}
function checkEntityUpdated(a, before, after) {
    const beforeEntity = (before[a.entityType] ?? []).find(e => titleMatches(e, a.titleMatch));
    const afterEntity = (after[a.entityType] ?? []).find(e => titleMatches(e, a.titleMatch));
    if (!beforeEntity) {
        return { description: a.description, type: a.type, passed: false, message: `No pre-existing ${a.entityType} matching "${a.titleMatch}"` };
    }
    if (!afterEntity) {
        return { description: a.description, type: a.type, passed: false, message: `${a.entityType} matching "${a.titleMatch}" was deleted` };
    }
    const beforeUpdated = beforeEntity.meta.updated;
    const afterUpdated = afterEntity.meta.updated;
    // Check timestamp change OR any field value change
    if (afterUpdated !== beforeUpdated) {
        return { description: a.description, type: a.type, passed: true, message: `${a.entityType} "${afterEntity.title}" was updated (timestamp changed)` };
    }
    // Fallback: check if any metadata field actually changed
    for (const key of Object.keys(afterEntity.meta)) {
        if (key === '_filepath')
            continue;
        if (JSON.stringify(afterEntity.meta[key]) !== JSON.stringify(beforeEntity.meta[key])) {
            return { description: a.description, type: a.type, passed: true, message: `${a.entityType} "${afterEntity.title}" was updated (field "${key}" changed)` };
        }
    }
    // Also check body content
    if (afterEntity.body !== beforeEntity.body) {
        return { description: a.description, type: a.type, passed: true, message: `${a.entityType} "${afterEntity.title}" was updated (body changed)` };
    }
    return { description: a.description, type: a.type, passed: false, message: `${a.entityType} "${afterEntity.title}" was NOT updated (no changes detected)` };
}
function checkEntityTypeCorrect(a, after) {
    // Check it exists under the expected type
    const inExpected = (after[a.expectedType] ?? []).find(e => titleMatches(e, a.titleMatch));
    if (!inExpected) {
        // Search all types to report where it ended up
        for (const [type, entities] of Object.entries(after)) {
            const found = entities.find(e => titleMatches(e, a.titleMatch));
            if (found) {
                return { description: a.description, type: a.type, passed: false, actual: type, message: `"${a.titleMatch}" found as ${type}, expected ${a.expectedType}` };
            }
        }
        return { description: a.description, type: a.type, passed: false, message: `"${a.titleMatch}" not found in any entity type` };
    }
    // Check it's not in wrong types
    if (a.wrongTypes) {
        for (const wt of a.wrongTypes) {
            const inWrong = (after[wt] ?? []).find(e => titleMatches(e, a.titleMatch));
            if (inWrong) {
                return { description: a.description, type: a.type, passed: false, actual: wt, message: `"${a.titleMatch}" also found as ${wt} (should only be ${a.expectedType})` };
            }
        }
    }
    return { description: a.description, type: a.type, passed: true, actual: a.expectedType, message: `"${a.titleMatch}" correctly created as ${a.expectedType}` };
}
function checkEntityField(a, after) {
    const entity = (after[a.entityType] ?? []).find(e => titleMatches(e, a.titleMatch));
    if (!entity) {
        return { description: a.description, type: a.type, passed: false, message: `No ${a.entityType} matching "${a.titleMatch}" found` };
    }
    const actual = entity.meta[a.field];
    if (typeof a.expected === 'string' && typeof actual === 'string') {
        if (actual.toLowerCase().includes(a.expected.toLowerCase())) {
            return { description: a.description, type: a.type, passed: true, actual, message: `${a.field} = "${actual}" contains "${a.expected}"` };
        }
    }
    if (actual === a.expected) {
        return { description: a.description, type: a.type, passed: true, actual, message: `${a.field} = ${JSON.stringify(actual)}` };
    }
    return { description: a.description, type: a.type, passed: false, actual, message: `${a.field} = ${JSON.stringify(actual)}, expected ${JSON.stringify(a.expected)}` };
}
function checkEntityNotCreated(a, before, after) {
    const created = newEntities(before, after, a.entityType);
    const match = created.find(e => titleMatches(e, a.titleMatch));
    if (match) {
        return { description: a.description, type: a.type, passed: false, actual: match.title, message: `Unwanted ${a.entityType} was created: "${match.title}"` };
    }
    return { description: a.description, type: a.type, passed: true, message: `No unwanted ${a.entityType} matching "${a.titleMatch}" was created` };
}
function checkEntityCount(a, after) {
    const count = (after[a.entityType] ?? []).length;
    if (count === a.expected) {
        return { description: a.description, type: a.type, passed: true, actual: count, message: `${a.entityType} count = ${count}` };
    }
    return { description: a.description, type: a.type, passed: false, actual: count, message: `${a.entityType} count = ${count}, expected ${a.expected}` };
}
function checkContextTypeCreated(a, after) {
    // A context type is "created" if it has an entry in the snapshot (even if empty)
    if (a.typeName in after) {
        return { description: a.description, type: a.type, passed: true, message: `Context type "${a.typeName}" was created` };
    }
    const available = Object.keys(after).join(', ');
    return { description: a.description, type: a.type, passed: false, message: `Context type "${a.typeName}" not found. Available: [${available}]` };
}
function checkResponseContains(a, responseText) {
    if (responseText.toLowerCase().includes(a.match.toLowerCase())) {
        return { description: a.description, type: a.type, passed: true, message: `Response contains "${a.match}"` };
    }
    return { description: a.description, type: a.type, passed: false, actual: responseText.slice(0, 200), message: `Response does not contain "${a.match}"` };
}
