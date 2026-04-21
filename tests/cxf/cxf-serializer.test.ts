// ─────────────────────────────────────────────────────────────────────────────
// CXF Serializer — Persona-based tests
//
// Tests the CXF/1 serializer across 8 real-world user archetypes without
// any LLM calls, vault I/O, or external dependencies.
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
        tags: [],
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

function assertContains(doc: string, fragment: string, label = fragment) {
    expect(doc, `Expected CXF document to contain: ${label}`).toContain(fragment);
}

function assertNotContains(doc: string, fragment: string, label = fragment) {
    expect(doc, `Expected CXF document NOT to contain: ${label}`).not.toContain(fragment);
}

function lines(doc: string): string[] {
    // Unfold continuation lines then split
    return doc.replace(/\r\n[ \t]/g, '').split(/\r\n|\n/).filter(Boolean);
}

function countOccurrences(doc: string, fragment: string): number {
    return doc.split(fragment).length - 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSONA 1 — SOCCER MOM
// High event volume, many linked people, recurring tasks, location-heavy
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
        tags: ['soccer', 'u12'],
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
        tags: ['soccer'],
        meta: { created: '2026-04-01T00:00:00Z', status: 'open', priority: 'medium', dueDate: '2026-04-25' },
    });

    const teamNote = node({
        id: 'note-team-roster-003', type: 'note', title: 'U12 Team Roster Notes',
        meta: { created: '2026-04-01T00:00:00Z' },
        bodySnippet: 'Jamie is left wing, Sam is keeper.',
    });

    const types = [eventType(), taskType(), noteType(), personType()];
    const nodes = [match, snacks, teamNote, jamie, sam, coach];

    it('emits VEVENT for match', () => {
        const { document } = serializeToCxf(nodes, types, [], BASE_OPTS);
        assertContains(document, 'BEGIN:VEVENT');
        assertContains(document, 'SUMMARY:U12 Match vs Westside');
        assertContains(document, 'DTSTART:20260425T140000Z');
        assertContains(document, 'DURATION:PT1H30M');
        assertContains(document, 'LOCATION:Riverside Park\\, Field 3');
        assertContains(document, 'CATEGORIES:soccer,u12');
    });

    it('expands person links as ATTENDEE with correct roles', () => {
        const { document } = serializeToCxf(nodes, types, [], BASE_OPTS);
        // team-member → REQ-PARTICIPANT
        assertContains(document, 'CN=Jamie Torres');
        assertContains(document, 'ROLE=REQ-PARTICIPANT');
        assertContains(document, 'mailto:jamie@example.com');
        assertContains(document, 'X-CXF-PERSON-ID=person-jamie-torres-ab12');
        // assigned-to → CHAIR (coach)
        assertContains(document, 'CN=Coach Nick');
        assertContains(document, 'ROLE=CHAIR');
        assertContains(document, 'mailto:nick@westside.fc');
    });

    it('uses synthetic email for person without email', () => {
        const { document } = serializeToCxf(nodes, types, [], BASE_OPTS);
        assertContains(document, 'mailto:person-sam-reeves-cd34@cxf.local');
    });

    it('emits VTODO for task with correct status and priority', () => {
        const { document } = serializeToCxf(nodes, types, [], BASE_OPTS);
        assertContains(document, 'BEGIN:VTODO');
        assertContains(document, 'SUMMARY:Bring snacks for post-game');
        assertContains(document, 'STATUS:NEEDS-ACTION');
        assertContains(document, 'PRIORITY:5'); // medium
        assertContains(document, 'DUE:20260425');
    });

    it('emits VJOURNAL for note', () => {
        const { document } = serializeToCxf(nodes, types, [], BASE_OPTS);
        assertContains(document, 'BEGIN:VJOURNAL');
        assertContains(document, 'SUMMARY:U12 Team Roster Notes');
    });

    it('includes VSCHEMA for all types with nodes', () => {
        const { document, schemaCount } = serializeToCxf(nodes, types, [], BASE_OPTS);
        assertContains(document, 'BEGIN:VSCHEMA');
        assertContains(document, 'X-CXF-TYPE-NAME:event');
        assertContains(document, 'X-CXF-TYPE-NAME:task');
        assertContains(document, 'X-CXF-TYPE-NAME:note');
        expect(schemaCount).toBeGreaterThanOrEqual(3);
    });

    it('emits correct entity count', () => {
        const { entityCount } = serializeToCxf(nodes, types, [], BASE_OPTS);
        expect(entityCount).toBe(nodes.length);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERSONA 2 — CEO
// Goals, todonts, high-priority tasks, people with roles
// ─────────────────────────────────────────────────────────────────────────────

describe('Persona: CEO', () => {
    const bob = node({ id: 'person-bob-smith-c3d4', type: 'person', title: 'Bob Smith',
        meta: { created: '2026-01-01T00:00:00Z', email: 'bob@acme.com' } });

    const boardDeck = node({
        id: 'task-board-deck-001', type: 'task', title: 'Prepare Q3 board deck',
        tags: ['board', 'q3'],
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
        tags: ['leadership'],
        meta: {
            created: '2026-02-01T00:00:00Z', status: 'in-progress',
            reason: 'Kills team autonomy and slows delivery velocity.',
        },
    });

    const types = [taskType(), goalType(), todontType(), personType()];
    const nodes = [boardDeck, buildTeam, reviewBob, micromanage, bob];

    it('emits VTODO for goals', () => {
        const { document } = serializeToCxf(nodes, types, [], BASE_OPTS);
        assertContains(document, 'SUMMARY:Build a great engineering team');
        assertContains(document, 'X-CXF-TYPE:goal');
        assertContains(document, 'STATUS:IN-PROCESS'); // active → IN-PROCESS
    });

    it('emits critical priority as PRIORITY:1', () => {
        const { document } = serializeToCxf(nodes, types, [], BASE_OPTS);
        assertContains(document, 'PRIORITY:1');
    });

    it('todont uses IN-PROCESS status by default', () => {
        const { document } = serializeToCxf(nodes, types, [], BASE_OPTS);
        assertContains(document, 'X-CXF-TYPE:todont');
        assertContains(document, 'STATUS:IN-PROCESS');
    });

    it('todont includes reason field', () => {
        const { document } = serializeToCxf(nodes, types, [], BASE_OPTS);
        assertContains(document, 'X-CXF-FIELD-REASON:Kills team autonomy');
    });

    it('todont is NOT always CANCELLED', () => {
        const { document } = serializeToCxf(nodes, types, [], BASE_OPTS);
        // Find the todont component and check its STATUS is not CANCELLED
        const todontStart = document.indexOf('X-CXF-TYPE:todont');
        const snippet = document.slice(Math.max(0, todontStart - 200), todontStart + 50);
        expect(snippet).not.toContain('STATUS:CANCELLED');
    });

    it('person links on task emit ATTENDEE as CHAIR', () => {
        const { document } = serializeToCxf(nodes, types, [], BASE_OPTS);
        assertContains(document, 'CN=Bob Smith');
        assertContains(document, 'ROLE=CHAIR');
        assertContains(document, 'mailto:bob@acme.com');
    });

    it('non-person link on task emits X-CXF-LINK', () => {
        const { document } = serializeToCxf(nodes, types, [], BASE_OPTS);
        assertContains(document, 'X-CXF-LINK');
        assertContains(document, 'LABEL=relates-to');
    });

    it('includes correct UID format {id}@{vaultId}', () => {
        const { document } = serializeToCxf(nodes, types, [], BASE_OPTS);
        assertContains(document, 'UID:task-board-deck-001@test-vault-01');
        assertContains(document, 'UID:goal-great-team-e5f6@test-vault-01');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERSONA 3 — ENGINEERING MANAGER
// Blocked tasks, person links with multiple roles, mixed priorities
// ─────────────────────────────────────────────────────────────────────────────

describe('Persona: Engineering Manager', () => {
    const alice = node({ id: 'person-alice-dev-0001', type: 'person', title: 'Alice Dev',
        meta: { created: '2026-01-01T00:00:00Z', email: 'alice@eng.co' } });

    const blockedTask = node({
        id: 'task-deploy-prod-b001', type: 'task', title: 'Deploy v2 to production',
        tags: ['release'],
        meta: {
            created: '2026-04-10T00:00:00Z', status: 'blocked', priority: 'critical',
            links: [{ target: 'person:person-alice-dev-0001', label: 'responsible' }],
        },
    });

    const doneTask = node({
        id: 'task-pr-review-b002', type: 'task', title: 'Review auth PR',
        meta: { created: '2026-04-12T00:00:00Z', status: 'done', priority: 'high' },
    });

    it('blocked task maps to IN-PROCESS + X-CXF-STATUS-EXT:blocked', () => {
        const { document } = serializeToCxf([blockedTask, alice], [taskType(), personType()], [], BASE_OPTS);
        assertContains(document, 'STATUS:IN-PROCESS');
        assertContains(document, 'X-CXF-STATUS-EXT:blocked');
    });

    it('done task maps to STATUS:COMPLETED', () => {
        const { document } = serializeToCxf([doneTask], [taskType()], [], BASE_OPTS);
        assertContains(document, 'STATUS:COMPLETED');
    });

    it('"responsible" link label maps to ROLE=CHAIR', () => {
        const { document } = serializeToCxf([blockedTask, alice], [taskType(), personType()], [], BASE_OPTS);
        assertContains(document, 'ROLE=CHAIR');
        assertContains(document, 'CN=Alice Dev');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERSONA 4 — BUSY PARENT
// Mix of events, tasks, notes; personal and school tags; no priorities set
// ─────────────────────────────────────────────────────────────────────────────

describe('Persona: Busy Parent', () => {
    const dentist = node({
        id: 'event-dentist-001', type: 'event', title: "Kids' dentist appointment",
        tags: ['family', 'health'],
        meta: { created: '2026-04-01T00:00:00Z', startDate: '2026-05-10T09:00:00Z', location: 'City Dental' },
    });

    const packLunch = node({
        id: 'task-pack-lunch-002', type: 'task', title: 'Pack school lunches',
        tags: ['daily', 'school'],
        meta: { created: '2026-04-01T00:00:00Z', status: 'open' },
    });

    const schoolNote = node({
        id: 'note-school-update-003', type: 'note', title: 'School newsletter notes',
        tags: ['school'],
        meta: { created: '2026-04-15T00:00:00Z' },
    });

    it('event without duration emits only DTSTART', () => {
        const { document } = serializeToCxf([dentist], [eventType()], [], BASE_OPTS);
        assertContains(document, 'BEGIN:VEVENT');
        assertContains(document, 'DTSTART:20260510T090000Z');
        assertContains(document, 'LOCATION:City Dental');
        assertNotContains(document, 'DURATION:');
    });

    it('task without priority emits PRIORITY:0 (undefined)', () => {
        const { document } = serializeToCxf([packLunch], [taskType()], [], BASE_OPTS);
        assertContains(document, 'PRIORITY:0');
    });

    it('note gets VJOURNAL with DTSTART derived from createdAt', () => {
        const { document } = serializeToCxf([schoolNote], [noteType()], [], BASE_OPTS);
        assertContains(document, 'BEGIN:VJOURNAL');
        assertContains(document, 'DTSTART:20260415');
    });

    it('CATEGORIES includes all tags', () => {
        const { document } = serializeToCxf([dentist], [eventType()], [], BASE_OPTS);
        assertContains(document, 'CATEGORIES:family,health');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERSONA 5 — RESEARCHER / ACADEMIC
// Heavy notes, custom entity types, long body content
// ─────────────────────────────────────────────────────────────────────────────

describe('Persona: Researcher', () => {
    const paperNote = node({
        id: 'note-llm-survey-001', type: 'note', title: 'Survey of LLM architectures',
        tags: ['ai', 'research'],
        bodySnippet: 'Transformers have dominated NLP since 2017. Key papers: BERT (2018), GPT-2 (2019), GPT-3 (2020). The attention mechanism allows models to focus on relevant tokens regardless of distance.',
        meta: { created: '2026-03-01T00:00:00Z' },
    });

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
        tags: ['ai', 'benchmarks'],
        meta: {
            created: '2026-03-15T00:00:00Z', status: 'in-progress',
            hypothesis: 'Larger models are not always better on specialized tasks.',
            sources: ['arxiv.org/abs/2304.15004', 'openai.com/research'],
        },
    });

    it('custom type emits VCONTEXT', () => {
        const { document } = serializeToCxf([researchEntity], [researchType], [], BASE_OPTS);
        assertContains(document, 'BEGIN:VCONTEXT');
        assertContains(document, 'X-CXF-TYPE:research');
        assertContains(document, 'END:VCONTEXT');
    });

    it('custom fields emitted as X-CXF-FIELD-*', () => {
        const { document } = serializeToCxf([researchEntity], [researchType], [], BASE_OPTS);
        assertContains(document, 'X-CXF-FIELD-HYPOTHESIS:');
        assertContains(document, 'Larger models are not always better');
    });

    it('VSCHEMA for custom type includes field definitions', () => {
        const { document } = serializeToCxf([researchEntity], [researchType], [], BASE_OPTS);
        assertContains(document, 'X-CXF-TYPE-NAME:research');
        assertContains(document, 'X-CXF-FIELD;KEY=status');
        assertContains(document, 'X-CXF-FIELD;KEY=hypothesis');
    });

    it('note body appears in DESCRIPTION', () => {
        const noteWithBody = { ...paperNote, bodySnippet: 'Transformers have dominated NLP since 2017.' };
        const { document } = serializeToCxf(
            [{ ...noteWithBody, meta: { ...noteWithBody.meta, body: noteWithBody.bodySnippet } }],
            [noteType()], [], BASE_OPTS
        );
        assertContains(document, 'DESCRIPTION:');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERSONA 6 — FREELANCER
// Client management, invoices, project goals with custom types
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
        tags: ['saas', 'enterprise'],
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

    it('client entity emits VCONTEXT with correct type', () => {
        const { document } = serializeToCxf([acme], [clientType], [], BASE_OPTS);
        assertContains(document, 'BEGIN:VCONTEXT');
        assertContains(document, 'X-CXF-TYPE:client');
        assertContains(document, 'SUMMARY:Acme Corp');
        assertContains(document, 'CATEGORIES:saas,enterprise');
    });

    it('client schema is emitted with field definitions', () => {
        const { document } = serializeToCxf([acme], [clientType], [], BASE_OPTS);
        assertContains(document, 'X-CXF-TYPE-NAME:client');
        assertContains(document, 'X-CXF-DESCRIPTION:Freelance clients and accounts');
        assertContains(document, 'KEY=budget;TYPE=NUMBER');
        assertContains(document, 'KEY=status;TYPE=ENUM;VALUES=prospect,active,completed,churned');
    });

    it('non-person link on task emits X-CXF-LINK with label', () => {
        const { document } = serializeToCxf([invoiceTask, acme], [taskType(), clientType], [], BASE_OPTS);
        assertContains(document, 'X-CXF-LINK');
        assertContains(document, 'LABEL=belongs-to');
        assertContains(document, 'client-acme-co-001@test-vault-01');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERSONA 7 — EXECUTIVE ASSISTANT
// Many people, delegated tasks, observer and notifier roles
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
            [taskType(), personType()], [], BASE_OPTS
        );
        assertContains(document, 'CN=PR Manager');
        assertContains(document, 'ROLE=CHAIR');
        assertContains(document, 'CN=CEO');
        assertContains(document, 'ROLE=OPT-PARTICIPANT');
        assertContains(document, 'CN=Board Observer');
        assertContains(document, 'ROLE=NON-PARTICIPANT');
    });

    it('three attendees means three ATTENDEE lines', () => {
        const { document } = serializeToCxf(
            [pressRelease, ceo, pr, board],
            [taskType(), personType()], [], BASE_OPTS
        );
        expect(countOccurrences(document, 'BEGIN:ATTENDEE')).toBe(0); // not a block
        expect(countOccurrences(document, 'ROLE=')).toBe(3);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERSONA 8 — STARTUP FOUNDER
// Mix of everything: goals, todonts, events, notes, custom types
// ─────────────────────────────────────────────────────────────────────────────

describe('Persona: Startup Founder', () => {
    const goal = node({
        id: 'goal-series-a-001', type: 'goal', title: 'Close Series A funding',
        meta: { created: '2026-01-01T00:00:00Z', status: 'active', priority: 'high' },
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

    const pitchEvent = node({
        id: 'event-pitch-day-001', type: 'event', title: 'Seed round pitch day',
        meta: { created: '2026-04-01T00:00:00Z', startDate: '2026-05-01T09:00:00Z', location: 'VC HQ' },
    });

    const archivedGoal = node({
        id: 'goal-old-pivot-002', type: 'goal', title: 'Old pivot strategy (deprecated)',
        meta: { created: '2025-01-01T00:00:00Z', status: 'abandoned', archivedAt: '2026-01-15T00:00:00Z' },
    });

    it('active todont uses IN-PROCESS', () => {
        const { document } = serializeToCxf([todontActiveDef], [todontType()], [], BASE_OPTS);
        assertContains(document, 'STATUS:IN-PROCESS');
        assertNotContains(document, 'STATUS:CANCELLED');
    });

    it('completed todont uses COMPLETED', () => {
        const { document } = serializeToCxf([todontCompleted], [todontType()], [], BASE_OPTS);
        assertContains(document, 'STATUS:COMPLETED');
    });

    it('cancelled todont uses CANCELLED', () => {
        const { document } = serializeToCxf([todontCancelled], [todontType()], [], BASE_OPTS);
        assertContains(document, 'STATUS:CANCELLED');
    });

    it('archived entities excluded by default', () => {
        const opts = { ...BASE_OPTS, includeArchived: false };
        const { document, entityCount } = serializeToCxf(
            [goal, archivedGoal, pitchEvent],
            [goalType(), eventType()], [], opts
        );
        assertNotContains(document, 'Old pivot strategy');
        // 2 non-archived nodes
        expect(entityCount).toBe(2);
    });

    it('archived entities included when includeArchived=true', () => {
        const opts = { ...BASE_OPTS, includeArchived: true };
        const { document, entityCount } = serializeToCxf(
            [goal, archivedGoal, pitchEvent],
            [goalType(), eventType()], [], opts
        );
        assertContains(document, 'Old pivot strategy');
        assertContains(document, 'X-CXF-ARCHIVED:TRUE');
        expect(entityCount).toBe(3);
    });

    it('tombstone emits X-CXF-DELETED:TRUE', () => {
        const tombstone: CxfTombstone = {
            entityId: 'goal-deleted-999',
            vaultId: BASE_OPTS.vaultId,
            type: 'deleted',
            title: 'Deleted goal',
            updatedAtUnix: 1745222000,
        };
        const { document } = serializeToCxf([goal], [goalType()], [tombstone], BASE_OPTS);
        assertContains(document, 'UID:goal-deleted-999@test-vault-01');
        assertContains(document, 'X-CXF-DELETED:TRUE');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// RFC 5545 COMPLIANCE
// ─────────────────────────────────────────────────────────────────────────────

describe('RFC 5545 Compliance', () => {
    it('document starts with BEGIN:VCALENDAR and ends with END:VCALENDAR', () => {
        const nodes = [node({ id: 'task-001', type: 'task', title: 'Simple task',
            meta: { created: '2026-04-01T00:00:00Z', status: 'open' } })];
        const { document } = serializeToCxf(nodes, [taskType()], [], BASE_OPTS);
        expect(document.trimStart()).toMatch(/^BEGIN:VCALENDAR/);
        expect(document.trimEnd()).toMatch(/END:VCALENDAR$/);
    });

    it('includes required VCALENDAR header fields', () => {
        const { document } = serializeToCxf([], [], [], BASE_OPTS);
        assertContains(document, 'VERSION:2.0');
        assertContains(document, 'CALSCALE:GREGORIAN');
        assertContains(document, 'X-CXF-VERSION:1');
        assertContains(document, 'X-CXF-VAULT:test-vault-01');
        assertContains(document, 'X-CXF-EXPORT-TIME:1745222400');
        assertContains(document, 'X-CXF-OWNER-NAME:Test User');
    });

    it('long lines are folded at 75 octets', () => {
        const longTitle = 'A'.repeat(80);
        const nodes = [node({ id: 'task-long-001', type: 'task', title: longTitle,
            meta: { created: '2026-04-01T00:00:00Z' } })];
        const { document } = serializeToCxf(nodes, [taskType()], [], BASE_OPTS);
        const rawLines = document.split(/\r\n/);
        for (const line of rawLines) {
            expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
        }
    });

    it('PRODID is present', () => {
        const { document } = serializeToCxf([], [], [], BASE_OPTS);
        assertContains(document, 'PRODID:');
    });

    it('exclude_schema=false omits VSCHEMA blocks', () => {
        const opts = { ...BASE_OPTS, includeSchema: false };
        const nodes = [node({ id: 'task-001', type: 'task', title: 'T',
            meta: { created: '2026-04-01T00:00:00Z' } })];
        const { document, schemaCount } = serializeToCxf(nodes, [taskType()], [], opts);
        assertNotContains(document, 'BEGIN:VSCHEMA');
        expect(schemaCount).toBe(0);
    });

    it('exclude_graph=false omits ATTENDEE and X-CXF-LINK', () => {
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
        assertNotContains(document, 'ATTENDEE');
        assertNotContains(document, 'X-CXF-LINK');
    });
});
