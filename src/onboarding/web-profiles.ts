// ─────────────────────────────────────────────────────────────────────────────
// WEB ONBOARDING PROFILES
// Profile definitions for the browser-based onboarding flow.
// Used by the web-server to drive /api/onboarding-profiles and handleSetup.
// ─────────────────────────────────────────────────────────────────────────────

import type { EntityTypeConfig } from '../entities/entity-type-config.js';

export interface WebProfileQuestion {
    key: string;
    question: string;
    placeholder: string;
    optional?: boolean;
    multiline?: boolean;
}

export interface WebProfile {
    type: string;
    label: string;
    tagline: string;
    icon: string;
    accentColor: string;
    defaultPersonality: 'butler' | 'rockstar' | 'executive' | 'friend' | 'pip' | 'emm';
    questions: WebProfileQuestion[];
    entityTypes: EntityTypeConfig[];
    buildContextLines: (answers: Record<string, string>) => string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

const executiveProfile: WebProfile = {
    type: 'executive',
    label: 'Executive',
    tagline: 'Lead with clarity. Manage stakeholders, decisions, and strategic priorities.',
    icon: '💼',
    accentColor: '#1e3a5f',
    defaultPersonality: 'executive',
    questions: [
        { key: 'name',       question: "What's your name?",                            placeholder: 'e.g. Sarah' },
        { key: 'pronouns',   question: "Preferred pronouns?",                          placeholder: 'e.g. she/her, he/him, they/them', optional: true },
        { key: 'role',       question: "What's your role?",                            placeholder: 'e.g. CEO, COO, VP of Product' },
        { key: 'org',        question: "What organization do you lead?",               placeholder: 'e.g. Acme Corp' },
        { key: 'priorities', question: "What are your top 2–3 current priorities?",   placeholder: 'e.g. Q2 launch, board fundraise, hiring', multiline: true },
        { key: 'reports',    question: "Key direct reports?",                          placeholder: 'e.g. CTO, CFO, Head of Sales', optional: true },
    ],
    entityTypes: [
        {
            name: 'stakeholder', plural: 'stakeholders', directory: 'stakeholders',
            description: 'Key stakeholders — board members, investors, partners, customers',
            defaultTags: ['stakeholder'],
            fields: [
                { key: 'role',         type: 'string', label: 'Role' },
                { key: 'influence',    type: 'enum',   label: 'Influence',    values: ['low', 'medium', 'high', 'critical'] },
                { key: 'relationship', type: 'enum',   label: 'Relationship', values: ['ally', 'neutral', 'skeptic'] },
                { key: 'nextTouch',    type: 'date',   label: 'Next Touch' },
            ],
        },
        {
            name: 'decision', plural: 'decisions', directory: 'decisions',
            description: 'Key decisions made or under consideration',
            defaultTags: ['decision'],
            fields: [
                { key: 'status',  type: 'enum',   label: 'Status',  values: ['pending', 'decided', 'reversed'], default: 'pending', required: true },
                { key: 'date',    type: 'date',   label: 'Date' },
                { key: 'outcome', type: 'string', label: 'Outcome' },
            ],
            completionField: 'status', completionValue: 'decided',
        },
        {
            name: 'strategic-goal', plural: 'strategic-goals', directory: 'strategic-goals',
            description: 'Strategic goals and OKRs',
            defaultTags: ['goal'],
            fields: [
                { key: 'status',     type: 'enum', label: 'Status',     values: ['active', 'achieved', 'abandoned'], default: 'active', required: true },
                { key: 'targetDate', type: 'date', label: 'Target Date' },
                { key: 'metric',     type: 'string', label: 'Success Metric' },
            ],
            completionField: 'status', completionValue: 'achieved',
            calendarDateField: 'targetDate',
        },
    ],
    buildContextLines: (a) => [
        `# Executive Profile`,
        '',
        `- name: ${a.name || ''}`,
        a.pronouns ? `- pronouns: ${a.pronouns}` : '',
        a.role ? `- role: ${a.role}` : '',
        a.org ? `- organization: ${a.org}` : '',
        a.priorities ? `- priorities: ${a.priorities}` : '',
        a.reports ? `- direct_reports: ${a.reports}` : '',
    ].filter(Boolean),
};

const managerProfile: WebProfile = {
    type: 'manager',
    label: 'Manager',
    tagline: 'Keep your team moving. Track projects, 1:1s, and action items.',
    icon: '👥',
    accentColor: '#0d5f5c',
    defaultPersonality: 'executive',
    questions: [
        { key: 'name',     question: "What's your name?",              placeholder: 'e.g. Alex' },
        { key: 'pronouns', question: "Preferred pronouns?",            placeholder: 'e.g. she/her, he/him', optional: true },
        { key: 'role',     question: "What's your role or title?",     placeholder: 'e.g. Engineering Manager, Director of Marketing' },
        { key: 'teamSize', question: "How big is your team?",          placeholder: 'e.g. 8 direct reports' },
        { key: 'projects', question: "What are your main projects right now?", placeholder: 'e.g. platform migration, Q3 roadmap', optional: true },
    ],
    entityTypes: [
        {
            name: 'project', plural: 'projects', directory: 'projects',
            description: 'Ongoing projects and initiatives',
            defaultTags: ['project'],
            fields: [
                { key: 'status',     type: 'enum',   label: 'Status',      values: ['planning', 'active', 'on-hold', 'complete'], default: 'active', required: true },
                { key: 'dueDate',    type: 'date',   label: 'Due Date' },
                { key: 'owner',      type: 'string', label: 'Owner' },
            ],
            completionField: 'status', completionValue: 'complete',
            calendarDateField: 'dueDate',
        },
        {
            name: 'one-on-one', plural: 'one-on-ones', directory: 'one-on-ones',
            description: 'Regular 1:1 meetings with team members',
            defaultTags: ['1:1'],
            fields: [
                { key: 'person',    type: 'string', label: 'With', required: true },
                { key: 'cadence',   type: 'enum',   label: 'Cadence', values: ['weekly', 'biweekly', 'monthly'], default: 'weekly' },
                { key: 'nextDate',  type: 'date',   label: 'Next Date' },
            ],
            calendarDateField: 'nextDate',
        },
    ],
    buildContextLines: (a) => [
        `# Manager Profile`,
        '',
        `- name: ${a.name || ''}`,
        a.pronouns ? `- pronouns: ${a.pronouns}` : '',
        a.role ? `- role: ${a.role}` : '',
        a.teamSize ? `- team_size: ${a.teamSize}` : '',
        a.projects ? `- current_projects: ${a.projects}` : '',
    ].filter(Boolean),
};

const consultantProfile: WebProfile = {
    type: 'consultant',
    label: 'Consultant',
    tagline: 'Manage clients and engagements. Track deliverables and stay billable.',
    icon: '🤝',
    accentColor: '#7c2d12',
    defaultPersonality: 'executive',
    questions: [
        { key: 'name',        question: "What's your name?",                        placeholder: 'e.g. Jordan' },
        { key: 'pronouns',    question: "Preferred pronouns?",                      placeholder: 'e.g. she/her, he/him', optional: true },
        { key: 'specialty',   question: "What's your consulting specialty?",        placeholder: 'e.g. Strategy, IT, Finance, HR' },
        { key: 'clients',     question: "How many active clients do you have?",     placeholder: 'e.g. 3–5' },
        { key: 'deliverable', question: "Primary deliverable type?",                placeholder: 'e.g. reports, workshops, implementations', optional: true },
    ],
    entityTypes: [
        {
            name: 'client', plural: 'clients', directory: 'clients',
            description: 'Active and prospective clients',
            defaultTags: ['client'],
            fields: [
                { key: 'status',    type: 'enum',   label: 'Status',  values: ['prospect', 'active', 'paused', 'closed'], default: 'active', required: true },
                { key: 'industry',  type: 'string', label: 'Industry' },
                { key: 'contact',   type: 'string', label: 'Primary Contact' },
                { key: 'nextTouch', type: 'date',   label: 'Next Touch' },
            ],
            completionField: 'status', completionValue: 'closed',
        },
        {
            name: 'engagement', plural: 'engagements', directory: 'engagements',
            description: 'Client engagements and project scopes',
            defaultTags: ['engagement'],
            fields: [
                { key: 'client',    type: 'string', label: 'Client',   required: true },
                { key: 'status',    type: 'enum',   label: 'Status',   values: ['scoping', 'active', 'delivered', 'closed'], default: 'active', required: true },
                { key: 'startDate', type: 'date',   label: 'Start Date' },
                { key: 'endDate',   type: 'date',   label: 'End Date' },
                { key: 'budget',    type: 'string', label: 'Budget' },
            ],
            completionField: 'status', completionValue: 'closed',
            calendarDateField: 'startDate',
        },
        {
            name: 'deliverable', plural: 'deliverables', directory: 'deliverables',
            description: 'Client deliverables and milestones',
            defaultTags: ['deliverable'],
            fields: [
                { key: 'client',   type: 'string', label: 'Client' },
                { key: 'status',   type: 'enum',   label: 'Status', values: ['draft', 'in-review', 'delivered'], default: 'draft', required: true },
                { key: 'dueDate',  type: 'date',   label: 'Due Date' },
            ],
            completionField: 'status', completionValue: 'delivered',
            calendarDateField: 'dueDate',
        },
    ],
    buildContextLines: (a) => [
        `# Consultant Profile`,
        '',
        `- name: ${a.name || ''}`,
        a.pronouns ? `- pronouns: ${a.pronouns}` : '',
        a.specialty ? `- specialty: ${a.specialty}` : '',
        a.clients ? `- active_clients: ${a.clients}` : '',
        a.deliverable ? `- deliverable_type: ${a.deliverable}` : '',
    ].filter(Boolean),
};

const familyProfile: WebProfile = {
    type: 'family',
    label: 'Family',
    tagline: 'Keep the household running. Manage family schedules, chores, and memories.',
    icon: '🏠',
    accentColor: '#9f1239',
    defaultPersonality: 'friend',
    questions: [
        { key: 'name',       question: "What's your name?",                           placeholder: 'e.g. Jamie' },
        { key: 'pronouns',   question: "Preferred pronouns?",                         placeholder: 'e.g. she/her, he/him', optional: true },
        { key: 'household',  question: "Who's in your household?",                    placeholder: 'e.g. Partner + 2 kids (ages 7 & 10)' },
        { key: 'challenges', question: "What's hardest to stay on top of?",           placeholder: 'e.g. after-school activities, meal planning', multiline: true },
        { key: 'helpers',    question: "Anyone else helping manage things?",           placeholder: 'e.g. partner, babysitter', optional: true },
    ],
    entityTypes: [],
    buildContextLines: (a) => [
        `# Family Profile`,
        '',
        `- name: ${a.name || ''}`,
        a.pronouns ? `- pronouns: ${a.pronouns}` : '',
        a.household ? `- household: ${a.household}` : '',
        a.challenges ? `- challenges: ${a.challenges}` : '',
        a.helpers ? `- helpers: ${a.helpers}` : '',
    ].filter(Boolean),
};

const smallBusinessProfile: WebProfile = {
    type: 'small-business',
    label: 'Small Business',
    tagline: 'Run your business, not just your to-do list. Customers, staff, and operations.',
    icon: '🏢',
    accentColor: '#14532d',
    defaultPersonality: 'executive',
    questions: [
        { key: 'name',       question: "What's your name?",                               placeholder: 'e.g. Morgan' },
        { key: 'pronouns',   question: "Preferred pronouns?",                             placeholder: 'e.g. she/her, he/him', optional: true },
        { key: 'bizName',    question: "What's your business name?",                      placeholder: 'e.g. Bright Tile Co.' },
        { key: 'bizType',    question: "What kind of business?",                          placeholder: 'e.g. retail, restaurant, consulting, e-commerce' },
        { key: 'employees',  question: "How many employees?",                             placeholder: 'e.g. just me, 3, 15', optional: true },
        { key: 'challenges', question: "What's hardest to stay on top of?",              placeholder: 'e.g. customer follow-ups, inventory, scheduling', optional: true },
    ],
    entityTypes: [
        {
            name: 'customer', plural: 'customers', directory: 'customers',
            description: 'Customers and leads',
            defaultTags: ['customer'],
            fields: [
                { key: 'status',    type: 'enum',   label: 'Status',  values: ['lead', 'active', 'inactive'], default: 'active', required: true },
                { key: 'email',     type: 'string', label: 'Email' },
                { key: 'phone',     type: 'string', label: 'Phone' },
                { key: 'lastOrder', type: 'date',   label: 'Last Order' },
            ],
        },
        {
            name: 'vendor', plural: 'vendors', directory: 'vendors',
            description: 'Suppliers and vendors',
            defaultTags: ['vendor'],
            fields: [
                { key: 'category', type: 'string', label: 'Category' },
                { key: 'contact',  type: 'string', label: 'Contact' },
                { key: 'email',    type: 'string', label: 'Email' },
                { key: 'phone',    type: 'string', label: 'Phone' },
            ],
        },
    ],
    buildContextLines: (a) => [
        `# Small Business Profile`,
        '',
        `- name: ${a.name || ''}`,
        a.pronouns ? `- pronouns: ${a.pronouns}` : '',
        a.bizName ? `- business_name: ${a.bizName}` : '',
        a.bizType ? `- business_type: ${a.bizType}` : '',
        a.employees ? `- employees: ${a.employees}` : '',
        a.challenges ? `- challenges: ${a.challenges}` : '',
    ].filter(Boolean),
};

export const WEB_PROFILES: Record<string, WebProfile> = {
    executive: executiveProfile,
    manager: managerProfile,
    consultant: consultantProfile,
    family: familyProfile,
    'small-business': smallBusinessProfile,
};

export const WEB_PROFILE_LIST: WebProfile[] = [
    executiveProfile,
    managerProfile,
    consultantProfile,
    familyProfile,
    smallBusinessProfile,
];
