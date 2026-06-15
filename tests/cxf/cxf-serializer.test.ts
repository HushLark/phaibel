// ─────────────────────────────────────────────────────────────────────────────
// CXF Serializer — Persona-based tests
//
// Tests the CXF/2 JSON-LD serializer across 8 real-world user archetypes
// without any LLM calls, vault I/O, or external dependencies.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { serializeToCxf } from '../../src/cxf/cxf-serializer.js';
import type { CxfExportOpts, CxfTombstone } from '../../src/cxf/cxf-serializer.js';
import type { IndexNode } from '../../src/entities/entity-index.js';
import type { EntityTypeConfig } from '../../src/entities/entity-type-config.js';

// ─────────────────────────────────────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const BASE_OPTS: CxfExportOpts = {
    vaultId: 'test-vault-01',
    ownerName: 'Test User',
    ownerEmail: 'test@example.com',
    exportTime: 1745222400,
    includeSchema: true,
    includeGraph: true,
    includeArchived: false,
};

function node(overrides: Partial<IndexNode> & { id: string; type: string; title: string }): IndexNode {
    return {
        filepath: `/vault/${overrides.type}s/${overrides.id}.md`,
        summary: '',
        bodySnippet: '',
        meta: { created: '2026-04-01T00:00:00Z', ...overrides.meta },
        ...overrides,
    } as IndexNode;
}

function taskType(): EntityTypeConfig {
    return {
        name: 'task', plural: 'tasks', directory: 'tasks',
        fields: [
            { key: 'status', type: 'enum', values: ['open', 'in-progress', 'done', 'blocked'] },
            { key: 'priority', type: 'enum', values: ['low', 'medium', 'high', 'critical'] },
            { key: 'dueDate', type: 'date' },
        ],
        completionField: 'status', completionValue: 'done',
    };
}

function eventType(): EntityTypeConfig {
    return {
        name: 'event', plural: 'events', directory: 'events',
        fields: [
            { key: 'startDate', type: 'datetime' },
            { key: 'duration', type: 'duration' },
            { key: 'location', type: 'string' },
        ],
    };
}

function noteType(): EntityTypeConfig {
    return { name: 'note', plural: 'notes', directory: 'notes', fields: [] };
}

function goalType(): EntityTypeConfig {
    return {
        name: 'goal', plural: 'goals', directory: 'goals',
        fields: [
            { key: 'status', type: 'enum', values: ['active', 'completed', 'paused', 'abandoned'] },
            { key: 'priority', type: 'enum', values: ['low', 'medium', 'high'] },
        ],
    };
}

function todontType(): EntityTypeConfig {
    return {
        name: 'todont', plural: 'todonts', directory: 'todonts',
        fields: [
            { key: 'status', type: 'enum', values: ['open', 'in-progress', 'done', 'cancelled'] },
            { key: 'reason', type: 'string' },
        ],
    };
}

function personType(): EntityTypeConfig {
    return {
        name: 'person', plural: 'people', directory: 'people',
        fields: [
            { key: 'email', type: 'string' },
            { key: 'company', type: 'string' },
        ],
    };
}

/** Parse the JSON-LD document. */
function parse(doc: string): Record<string, unknown> {
    return JSON.parse(doc);
}

/** Find a node in @graph by entity ID suffix. */
function graphNode(doc: string, entityId: string): Record<string, unknown> | undefined {
    const parsed = parse(doc);
    const graph = parsed['@graph'] as Record<string, unknown>[];
    return graph?.find(n => String(n['@id'] ?? '').endsWith(`:${entityId}`));
}

/** Find all graph nodes of a given nativeType. */
function graphNodesOfType(doc: string, nativeType: string): Record<string, unknown>[] {
    const parsed = parse(doc);
    const graph = parsed['@graph'] as Record<string, unknown>[];
    return graph?.filter(n => n['cxf:nativeType'] === nativeType) ?? [];
}

/** Find a schema entry by typeName. */
function schemaFor(doc: string, typeName: string): Record<string, unknown> | undefined {
    const parsed = parse(doc);
    const schemas = parsed['cxf:schemas'] as Record<string, unknown>[] | undefined;
    return schemas?.find(s => s['cxf:typeName'] === typeName);
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSONA 1 — SOCCER MOM
// ─────────────────────────────────────────────────────────────────────────────

describe('Persona: Soccer Mom', () => {
    const jamie = node({ id: 'person-jamie-torres-ab12', type: 'person', title: 'Jamie Torres',
        meta: { created: '2026-01-01T00:00:00Z', email: 'jamie@example.com' } });
    const sam = node({ id: 'person-sam-reeves-cd34', type: 'person', title: 'Sam Reeves',
        meta: { created: '2026-01-01T00:00:00Z' } });
    const coach = node({ id: 'person-coach-nick-ef56', type: 'person', title: 'Coach Nick',
        meta: { created: '2026-01-01T00:00:00Z', email: 'nick@westside.fc' } });

    const match = node({
        id: 'event-soccer-u12-001', type: 'event', title: 'U12 Match vs Westside',
        meta: {
            created: '2026-04-01T00:00:00Z',
            startDate: '2026-04-25T14:00:00Z',
            duration: 'PT1H30M',
            location: 'Riverside Park, Field 3',
            links: [
                { target: 'person:person-jamie-torres-ab12', label: 'team-member' },
                { target: 'person:person-sam-reeves-cd34', label: 'team-member' },
                { target: 'person:person-coach-nick-ef56', label: 'assigned-to' },
            ],
        },
    });

    const snacks = node({
        id: 'task-snacks-002', type: 'task', title: 'Bring snacks for post-game',
        meta: { created: '2026-04-01T00:00:00Z', status: 'open', priority: 'medium', dueDate: '2026-04-25' },
    });

    const teamNote = node({
        id: 'note-team-roster-003', type: 'note', title: 'U12 Team Roster Notes',
        meta: { created: '2026-04-01T00:00:00Z' },
        bodySnippet: 'Jamie is left wing, Sam is keeper.',
    });

    const types = [eventType(), taskType(), noteType(), personType()];
    const nodes = [match, snacks, teamNote, jamie, sam, coach];

    it('emits cxf:Event for match', () => {
        const { document } = serializeToCxf(nodes, types, [], BASE_OPTS);
        const n = graphNode(document, 'event-soccer-u12-001');
        expect(n?.['@type']).toBe('cxf:Event');
        expect(n?.['schema:name']).toBe('U12 Match vs Westside');
        expect(n?.['schema:startDate']).toBe('2026-04-25T14:00:00Z');
        expect(n?.['schema:duration']).toBe('PT1H30M');
        expect(n?.['schema:location']).toBe('Riverside Park, Field 3');
    });

    it('expands person links as cxf:attendees with correct roles', () => {
        const { document } = serializeToCxf(nodes, types, [], BASE_OPTS);
        const n = graphNode(document, 'event-soccer-u12-001');
        const attendees = n?.['cxf:attendees'] as Record<string, unknown>[];
        expect(attendees).toBeDefined();

        const jamie = attendees.find(a => a['cxf:personId'] === 'person-jamie-torres-ab12');
        expect(jamie?.['cxf:role']).toBe('REQ-PARTICIPANT');
        expect(jamie?.['schema:email']).toBe('jamie@example.com');
        expect(jamie?.['schema:name']).toBe('Jamie Torres');

        const coachEntry = attendees.find(a => a['cxf:personId'] === 'person-coach-nick-ef56');
        expect(coachEntry?.['cxf:role']).toBe('CHAIR');
        expect(coachEntry?.['schema:email']).toBe('nick@westside.fc');
    });

    it('uses synthetic email for person without email', () => {
        const { document } = serializeToCxf(nodes, types, [], BASE_OPTS);
        const n = graphNode(document, 'event-soccer-u12-001');
        const attendees = n?.['cxf:attendees'] as Record<string, unknown>[];
        const sam = attendees.find(a => a['cxf:personId'] === 'person-sam-reeves-cd34');
        expect(sam?.['schema:email']).toBe('person-sam-reeves-cd34@cxf.local');
    });

    it('emits cxf:Task for task with status and priority', () => {
        const { document } = serializeToCxf(nodes, types, [], BASE_OPTS);
        const n = graphNode(document, 'task-snacks-002');
        expect(n?.['@type']).toBe('cxf:Task');
        expect(n?.['schema:name']).toBe('Bring snacks for post-game');
        expect(n?.['cxf:status']).toBe('open');
        expect(n?.['cxf:priority']).toBe('medium');
        expect(n?.['schema:dueDate']).toBe('2026-04-25');
    });

    it('emits cxf:Note for note', () => {
        const { document } = serializeToCxf(nodes, types, [], BASE_OPTS);
        const n = graphNode(document, 'note-team-roster-003');
        expect(n?.['@type']).toBe('cxf:Note');
        expect(n?.['schema:name']).toBe('U12 Team Roster Notes');
    });

    it('includes cxf:schemas for all types with nodes', () => {
        const { document, schemaCount } = serializeToCxf(nodes, types, [], BASE_OPTS);
        expect(schemaFor(document, 'event')).toBeDefined();
        expect(schemaFor(document, 'task')).toBeDefined();
        expect(schemaFor(document, 'note')).toBeDefined();
        expect(schemaCount).toBeGreaterThanOrEqual(3);
    });

    it('emits correct entity count', () => {
        const { entityCount } = serializeToCxf(nodes, types, [], BASE_OPTS);
        expect(entityCount).toBe(nodes.length);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERSONA 2 — CEO
// ─────────────────────────────────────────────────────────────────────────────

describe('Persona: CEO', () => {
    const bob = node({ id: 'person-bob-smith-c3d4', type: 'person', title: 'Bob Smith',
        meta: { created: '2026-01-01T00:00:00Z', email: 'bob@acme.com' } });

    const boardDeck = node({
        id: 'task-board-deck-001', type: 'task', title: 'Prepare Q3 board deck',
        meta: {
            created: '2026-04-01T00:00:00Z', status: 'in-progress', priority: 'critical', dueDate: '2026-04-28',
            links: [{ target: 'person:person-bob-smith-c3d4', label: 'assigned-to' }],
        },
    });

    const buildTeam = node({
        id: 'goal-great-team-e5f6', type: 'goal', title: 'Build a great engineering team',
        meta: { created: '2026-01-01T00:00:00Z', status: 'active', priority: 'high' },
    });

    const reviewBob = node({
        id: 'task-review-bob-a1b2', type: 'task', title: "Review Bob's performance",
        meta: {
            created: '2026-04-01T00:00:00Z', status: 'open', priority: 'high', dueDate: '2026-04-30',
            links: [
                { target: 'person:person-bob-smith-c3d4', label: 'assigned-to' },
                { target: 'goal:goal-great-team-e5f6', label: 'relates-to' },
            ],
        },
    });

    const micromanage = node({
        id: 'todont-micromanage-i9j0', type: 'todont', title: "Don't micromanage delivery",
        meta: {
            created: '2026-02-01T00:00:00Z', status: 'in-progress',
            reason: 'Kills team autonomy and slows delivery velocity.',
        },
    });

    const types = [taskType(), goalType(), todontType(), personType()];
    const nodes = [boardDeck, buildTeam, reviewBob, micromanage, bob];

    it('goal emits cxf:Task with cxf:nativeType=goal', () => {
        const { document } = serializeToCxf(nodes, types, [], BASE_OPTS);
        const n = graphNode(document, 'goal-great-team-e5f6');
        expect(n?.['@type']).toBe('cxf:Task');
        expect(n?.['cxf:nativeType']).toBe('goal');
        expect(n?.['cxf:status']).toBe('active');
    });

    it('critical priority preserved as-is', () => {
        const { document } = serializeToCxf(nodes, types, [], BASE_OPTS);
        const n = graphNode(document, 'task-board-deck-001');
        expect(n?.['cxf:priority']).toBe('critical');
    });

    it('todont preserves status natively', () => {
        const { document } = serializeToCxf(nodes, types, [], BASE_OPTS);
        const n = graphNode(document, 'todont-micromanage-i9j0');
        expect(n?.['cxf:nativeType']).toBe('todont');
        expect(n?.['cxf:status']).toBe('in-progress');
    });

    it('todont includes reason in cxf:fields', () => {
        const { document } = serializeToCxf(nodes, types, [], BASE_OPTS);
        const n = graphNode(document, 'todont-micromanage-i9j0');
        const fields = n?.['cxf:fields'] as Record<string, unknown> | undefined;
        expect(fields?.reason).toBe('Kills team autonomy and slows delivery velocity.');
    });

    it('person link on task emits attendee with CHAIR role', () => {
        const { document } = serializeToCxf(nodes, types, [], BASE_OPTS);
        const n = graphNode(document, 'task-board-deck-001');
        const attendees = n?.['cxf:attendees'] as Record<string, unknown>[];
        const bobEntry = attendees?.find(a => a['cxf:personId'] === 'person-bob-smith-c3d4');
        expect(bobEntry?.['cxf:role']).toBe('CHAIR');
        expect(bobEntry?.['schema:email']).toBe('bob@acme.com');
    });

    it('non-person link emits cxf:links entry', () => {
        const { document } = serializeToCxf(nodes, types, [], BASE_OPTS);
        const n = graphNode(document, 'task-review-bob-a1b2');
        const links = n?.['cxf:links'] as Record<string, unknown>[];
        const goalLink = links?.find(l => l['cxf:label'] === 'relates-to');
        expect(goalLink).toBeDefined();
        expect(String(goalLink?.['cxf:target'])).toContain('goal-great-team-e5f6');
    });

    it('@id uses urn:cxf:{vaultId}:{entityId} format', () => {
        const { document } = serializeToCxf(nodes, types, [], BASE_OPTS);
        const n = graphNode(document, 'task-board-deck-001');
        expect(n?.['@id']).toBe('urn:cxf:test-vault-01:task-board-deck-001');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERSONA 3 — ENGINEERING MANAGER
// ─────────────────────────────────────────────────────────────────────────────

describe('Persona: Engineering Manager', () => {
    const alice = node({ id: 'person-alice-dev-0001', type: 'person', title: 'Alice Dev',
        meta: { created: '2026-01-01T00:00:00Z', email: 'alice@eng.co' } });

    const blockedTask = node({
        id: 'task-deploy-prod-b001', type: 'task', title: 'Deploy v2 to production',
        meta: {
            created: '2026-04-10T00:00:00Z', status: 'blocked', priority: 'critical',
            links: [{ target: 'person:person-alice-dev-0001', label: 'responsible' }],
        },
    });

    const doneTask = node({
        id: 'task-pr-review-b002', type: 'task', title: 'Review auth PR',
        meta: { created: '2026-04-12T00:00:00Z', status: 'done', priority: 'high' },
    });

    it('blocked status preserved as-is in cxf:status', () => {
        const { document } = serializeToCxf([blockedTask, alice], [taskType(), personType()], [], BASE_OPTS);
        const n = graphNode(document, 'task-deploy-prod-b001');
        expect(n?.['cxf:status']).toBe('blocked');
    });

    it('done status preserved as-is', () => {
        const { document } = serializeToCxf([doneTask], [taskType()], [], BASE_OPTS);
        const n = graphNode(document, 'task-pr-review-b002');
        expect(n?.['cxf:status']).toBe('done');
    });

    it('"responsible" link label maps to CHAIR role', () => {
        const { document } = serializeToCxf([blockedTask, alice], [taskType(), personType()], [], BASE_OPTS);
        const n = graphNode(document, 'task-deploy-prod-b001');
        const attendees = n?.['cxf:attendees'] as Record<string, unknown>[];
        const aliceEntry = attendees?.find(a => a['schema:name'] === 'Alice Dev');
        expect(aliceEntry?.['cxf:role']).toBe('CHAIR');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERSONA 4 — BUSY PARENT
// ─────────────────────────────────────────────────────────────────────────────

describe('Persona: Busy Parent', () => {
    const dentist = node({
        id: 'event-dentist-001', type: 'event', title: "Kids' dentist appointment",
        meta: { created: '2026-04-01T00:00:00Z', startDate: '2026-05-10T09:00:00Z', location: 'City Dental' },
    });

    const packLunch = node({
        id: 'task-pack-lunch-002', type: 'task', title: 'Pack school lunches',
        meta: { created: '2026-04-01T00:00:00Z', status: 'open' },
    });

    const schoolNote = node({
        id: 'note-school-update-003', type: 'note', title: 'School newsletter notes',
        meta: { created: '2026-04-15T00:00:00Z' },
    });

    it('event without duration emits only schema:startDate', () => {
        const { document } = serializeToCxf([dentist], [eventType()], [], BASE_OPTS);
        const n = graphNode(document, 'event-dentist-001');
        expect(n?.['schema:startDate']).toBe('2026-05-10T09:00:00Z');
        expect(n?.['schema:location']).toBe('City Dental');
        expect(n?.['schema:duration']).toBeUndefined();
    });

    it('task without priority has no cxf:priority field', () => {
        const { document } = serializeToCxf([packLunch], [taskType()], [], BASE_OPTS);
        const n = graphNode(document, 'task-pack-lunch-002');
        expect(n?.['cxf:priority']).toBeUndefined();
    });

    it('note emits cxf:Note with dateCreated', () => {
        const { document } = serializeToCxf([schoolNote], [noteType()], [], BASE_OPTS);
        const n = graphNode(document, 'note-school-update-003');
        expect(n?.['@type']).toBe('cxf:Note');
        expect(n?.['schema:dateCreated']).toBe('2026-04-15T00:00:00Z');
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// PERSONA 5 — RESEARCHER
// ─────────────────────────────────────────────────────────────────────────────

describe('Persona: Researcher', () => {
    const researchType: EntityTypeConfig = {
        name: 'research', plural: 'research', directory: 'research',
        fields: [
            { key: 'status', type: 'enum', values: ['draft', 'in-progress', 'complete'] },
            { key: 'sources', type: 'array' },
            { key: 'hypothesis', type: 'string' },
        ],
    };

    const researchEntity = node({
        id: 'research-llm-perf-001', type: 'research', title: 'LLM performance benchmarks',
        meta: {
            created: '2026-03-15T00:00:00Z', status: 'in-progress',
            hypothesis: 'Larger models are not always better on specialized tasks.',
            sources: ['arxiv.org/abs/2304.15004', 'openai.com/research'],
        },
    });

    it('custom type emits cxf:Context with correct nativeType', () => {
        const { document } = serializeToCxf([researchEntity], [researchType], [], BASE_OPTS);
        const n = graphNode(document, 'research-llm-perf-001');
        expect(n?.['@type']).toBe('cxf:Context');
        expect(n?.['cxf:nativeType']).toBe('research');
    });

    it('custom fields appear in cxf:fields', () => {
        const { document } = serializeToCxf([researchEntity], [researchType], [], BASE_OPTS);
        const n = graphNode(document, 'research-llm-perf-001');
        const fields = n?.['cxf:fields'] as Record<string, unknown> | undefined;
        expect(fields?.hypothesis).toBe('Larger models are not always better on specialized tasks.');
    });

    it('cxf:schemas for custom type includes field definitions', () => {
        const { document } = serializeToCxf([researchEntity], [researchType], [], BASE_OPTS);
        const s = schemaFor(document, 'research');
        expect(s?.['cxf:typeName']).toBe('research');
        const fields = s?.['cxf:fields'] as Record<string, unknown>[];
        expect(fields?.some(f => f['cxf:key'] === 'hypothesis')).toBe(true);
        expect(fields?.some(f => f['cxf:key'] === 'status')).toBe(true);
    });

    it('note body appears in schema:description', () => {
        const paperNote = node({
            id: 'note-llm-survey-001', type: 'note', title: 'Survey of LLM architectures',
            meta: { created: '2026-03-01T00:00:00Z', body: 'Transformers have dominated NLP since 2017.' },
        });
        const { document } = serializeToCxf([paperNote], [noteType()], [], BASE_OPTS);
        const n = graphNode(document, 'note-llm-survey-001');
        expect(n?.['schema:description']).toContain('Transformers have dominated');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERSONA 6 — FREELANCER
// ─────────────────────────────────────────────────────────────────────────────

describe('Persona: Freelancer', () => {
    const clientType: EntityTypeConfig = {
        name: 'client', plural: 'clients', directory: 'clients',
        description: 'Freelance clients and accounts',
        fields: [
            { key: 'company', type: 'string', label: 'Company' },
            { key: 'budget', type: 'number', label: 'Budget (USD)' },
            { key: 'status', type: 'enum', values: ['prospect', 'active', 'completed', 'churned'] },
        ],
    };

    const acme = node({
        id: 'client-acme-co-001', type: 'client', title: 'Acme Corp',
        meta: {
            created: '2026-01-15T00:00:00Z', status: 'active',
            company: 'Acme Corp', budget: 15000,
        },
    });

    const invoiceTask = node({
        id: 'task-invoice-q1-002', type: 'task', title: 'Send Q1 invoice to Acme',
        meta: {
            created: '2026-04-01T00:00:00Z', status: 'open', priority: 'high', dueDate: '2026-04-30',
            links: [{ target: 'client:client-acme-co-001', label: 'belongs-to' }],
        },
    });

    it('client entity emits cxf:Context with correct type and name', () => {
        const { document } = serializeToCxf([acme], [clientType], [], BASE_OPTS);
        const n = graphNode(document, 'client-acme-co-001');
        expect(n?.['@type']).toBe('cxf:Context');
        expect(n?.['cxf:nativeType']).toBe('client');
        expect(n?.['schema:name']).toBe('Acme Corp');
    });

    it('client schema includes description and field definitions', () => {
        const { document } = serializeToCxf([acme], [clientType], [], BASE_OPTS);
        const s = schemaFor(document, 'client');
        expect(s?.['cxf:description']).toBe('Freelance clients and accounts');
        const fields = s?.['cxf:fields'] as Record<string, unknown>[];
        const budgetField = fields?.find(f => f['cxf:key'] === 'budget');
        expect(budgetField?.['cxf:type']).toBe('number');
        const statusField = fields?.find(f => f['cxf:key'] === 'status');
        expect(statusField?.['cxf:values']).toEqual(['prospect', 'active', 'completed', 'churned']);
    });

    it('non-person link on task emits cxf:links with correct label', () => {
        const { document } = serializeToCxf([invoiceTask, acme], [taskType(), clientType], [], BASE_OPTS);
        const n = graphNode(document, 'task-invoice-q1-002');
        const links = n?.['cxf:links'] as Record<string, unknown>[];
        const acmeLink = links?.find(l => l['cxf:label'] === 'belongs-to');
        expect(acmeLink).toBeDefined();
        expect(String(acmeLink?.['cxf:target'])).toContain('client-acme-co-001');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERSONA 7 — EXECUTIVE ASSISTANT
// ─────────────────────────────────────────────────────────────────────────────

describe('Persona: Executive Assistant', () => {
    const ceo = node({ id: 'person-ceo-001', type: 'person', title: 'CEO',
        meta: { created: '2026-01-01T00:00:00Z', email: 'ceo@corp.com' } });
    const pr = node({ id: 'person-pr-002', type: 'person', title: 'PR Manager',
        meta: { created: '2026-01-01T00:00:00Z' } });
    const board = node({ id: 'person-board-003', type: 'person', title: 'Board Observer',
        meta: { created: '2026-01-01T00:00:00Z' } });

    const pressRelease = node({
        id: 'task-press-release-001', type: 'task', title: 'Draft press release for product launch',
        meta: {
            created: '2026-04-01T00:00:00Z', status: 'open', priority: 'high',
            links: [
                { target: 'person:person-pr-002', label: 'assigned-to' },
                { target: 'person:person-ceo-001', label: 'attendee' },
                { target: 'person:person-board-003', label: 'observer' },
            ],
        },
    });

    it('assigned-to → CHAIR, attendee → OPT-PARTICIPANT, observer → NON-PARTICIPANT', () => {
        const { document } = serializeToCxf(
            [pressRelease, ceo, pr, board],
            [taskType(), personType()], [], BASE_OPTS,
        );
        const n = graphNode(document, 'task-press-release-001');
        const attendees = n?.['cxf:attendees'] as Record<string, unknown>[];

        const prEntry = attendees?.find(a => a['schema:name'] === 'PR Manager');
        expect(prEntry?.['cxf:role']).toBe('CHAIR');

        const ceoEntry = attendees?.find(a => a['schema:name'] === 'CEO');
        expect(ceoEntry?.['cxf:role']).toBe('OPT-PARTICIPANT');

        const boardEntry = attendees?.find(a => a['schema:name'] === 'Board Observer');
        expect(boardEntry?.['cxf:role']).toBe('NON-PARTICIPANT');
    });

    it('three person links produce three attendee entries', () => {
        const { document } = serializeToCxf(
            [pressRelease, ceo, pr, board],
            [taskType(), personType()], [], BASE_OPTS,
        );
        const n = graphNode(document, 'task-press-release-001');
        const attendees = n?.['cxf:attendees'] as Record<string, unknown>[];
        expect(attendees?.length).toBe(3);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERSONA 8 — STARTUP FOUNDER
// ─────────────────────────────────────────────────────────────────────────────

describe('Persona: Startup Founder', () => {
    const goal = node({
        id: 'goal-series-a-001', type: 'goal', title: 'Close Series A funding',
        meta: { created: '2026-01-01T00:00:00Z', status: 'active', priority: 'high' },
    });

    const pitchEvent = node({
        id: 'event-pitch-day-001', type: 'event', title: 'Seed round pitch day',
        meta: { created: '2026-04-01T00:00:00Z', startDate: '2026-05-01T09:00:00Z', location: 'VC HQ' },
    });

    const archivedGoal = node({
        id: 'goal-old-pivot-002', type: 'goal', title: 'Old pivot strategy (deprecated)',
        meta: { created: '2025-01-01T00:00:00Z', status: 'abandoned', archivedAt: '2026-01-15T00:00:00Z' },
    });

    const todontActiveDef = node({
        id: 'todont-pivot-too-early-001', type: 'todont', title: 'Pivot before product-market fit',
        meta: { created: '2026-02-01T00:00:00Z', status: 'in-progress', reason: "We've seen this fail 3 times." },
    });

    const todontCompleted = node({
        id: 'todont-skip-tests-002', type: 'todont', title: 'Skip writing tests',
        meta: { created: '2026-02-01T00:00:00Z', status: 'done', reason: 'Created massive tech debt last quarter.' },
    });

    const todontCancelled = node({
        id: 'todont-no-demos-003', type: 'todont', title: 'Skip live demos at investor meetings',
        meta: { created: '2026-03-01T00:00:00Z', status: 'cancelled', reason: 'Old advice, no longer relevant.' },
    });

    it('todont statuses preserved natively', () => {
        const { document } = serializeToCxf([todontActiveDef, todontCompleted, todontCancelled], [todontType()], [], BASE_OPTS);
        expect(graphNode(document, 'todont-pivot-too-early-001')?.['cxf:status']).toBe('in-progress');
        expect(graphNode(document, 'todont-skip-tests-002')?.['cxf:status']).toBe('done');
        expect(graphNode(document, 'todont-no-demos-003')?.['cxf:status']).toBe('cancelled');
    });

    it('archived entities excluded by default', () => {
        const opts = { ...BASE_OPTS, includeArchived: false };
        const { document, entityCount } = serializeToCxf(
            [goal, archivedGoal, pitchEvent],
            [goalType(), eventType()], [], opts,
        );
        expect(graphNode(document, 'goal-old-pivot-002')).toBeUndefined();
        expect(entityCount).toBe(2);
    });

    it('archived entities included when includeArchived=true', () => {
        const opts = { ...BASE_OPTS, includeArchived: true };
        const { document, entityCount } = serializeToCxf(
            [goal, archivedGoal, pitchEvent],
            [goalType(), eventType()], [], opts,
        );
        const n = graphNode(document, 'goal-old-pivot-002');
        expect(n?.['cxf:archived']).toBe(true);
        expect(entityCount).toBe(3);
    });

    it('tombstone emits cxf:deleted=true', () => {
        const tombstone: CxfTombstone = {
            entityId: 'goal-deleted-999',
            vaultId: BASE_OPTS.vaultId,
            type: 'deleted',
            title: 'Deleted goal',
            updatedAtUnix: 1745222000,
        };
        const { document } = serializeToCxf([goal], [goalType()], [tombstone], BASE_OPTS);
        const n = graphNode(document, 'goal-deleted-999');
        expect(n?.['@id']).toBe('urn:cxf:test-vault-01:goal-deleted-999');
        expect(n?.['cxf:deleted']).toBe(true);
        expect(n?.['cxf:archived']).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// JSON-LD STRUCTURE
// ─────────────────────────────────────────────────────────────────────────────

describe('JSON-LD Structure', () => {
    it('document is valid JSON with @context, cxf:version, and @graph', () => {
        const nodes = [node({ id: 'task-001', type: 'task', title: 'Simple task',
            meta: { created: '2026-04-01T00:00:00Z', status: 'open' } })];
        const { document } = serializeToCxf(nodes, [taskType()], [], BASE_OPTS);
        const parsed = parse(document);
        expect(parsed['@context']).toBeDefined();
        expect(parsed['cxf:version']).toBe('2');
        expect(parsed['cxf:vaultId']).toBe('test-vault-01');
        expect(parsed['cxf:exportTime']).toBe(1745222400);
        expect(parsed['cxf:ownerName']).toBe('Test User');
        expect(Array.isArray(parsed['@graph'])).toBe(true);
    });

    it('@context includes cxf and schema namespaces', () => {
        const { document } = serializeToCxf([], [], [], BASE_OPTS);
        const ctx = parse(document)['@context'] as Record<string, unknown>;
        expect(ctx['cxf']).toContain('cxf.phaibel.ai');
        expect(ctx['schema']).toContain('schema.org');
    });

    it('includeSchema=false omits cxf:schemas', () => {
        const opts = { ...BASE_OPTS, includeSchema: false };
        const nodes = [node({ id: 'task-001', type: 'task', title: 'T',
            meta: { created: '2026-04-01T00:00:00Z' } })];
        const { document, schemaCount } = serializeToCxf(nodes, [taskType()], [], opts);
        expect(parse(document)['cxf:schemas']).toBeUndefined();
        expect(schemaCount).toBe(0);
    });

    it('includeGraph=false omits cxf:attendees and cxf:links', () => {
        const opts = { ...BASE_OPTS, includeGraph: false };
        const person = node({ id: 'person-001', type: 'person', title: 'Alice',
            meta: { created: '2026-04-01T00:00:00Z', email: 'alice@test.com' } });
        const task = node({ id: 'task-001', type: 'task', title: 'Task with link',
            meta: {
                created: '2026-04-01T00:00:00Z',
                links: [{ target: 'person:person-001', label: 'assigned-to' }],
            },
        });
        const { document } = serializeToCxf([task, person], [taskType(), personType()], [], opts);
        const n = graphNode(document, 'task-001');
        expect(n?.['cxf:attendees']).toBeUndefined();
        expect(n?.['cxf:links']).toBeUndefined();
    });

    it('empty export still produces valid JSON-LD with empty @graph', () => {
        const { document } = serializeToCxf([], [], [], BASE_OPTS);
        const parsed = parse(document);
        expect(Array.isArray(parsed['@graph'])).toBe(true);
        expect((parsed['@graph'] as unknown[]).length).toBe(0);
    });
});
