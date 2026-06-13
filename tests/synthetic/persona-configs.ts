// ─────────────────────────────────────────────────────────────────────────────
// Synthetic data persona definitions
// Each persona drives ~300 vault entries exercising all 6 relevance signals.
// ─────────────────────────────────────────────────────────────────────────────

export interface EntityMix {
    tasks: number;
    events: number;
    people: number;
    notes: number;
    goals: number;
    contextEntities: number; // entities of persona-specific context types
}

export interface PersonaConfig {
    id: string;
    name: string;
    description: string;
    entityMix: EntityMix;
    // Seed facts passed to every batch so cross-references stay consistent
    spine: {
        people: string[];           // "Emma (daughter, age 8)"
        goals: string[];            // "Get Emma into the gifted programme by September"
        contextTypes: string[];     // "soccer game", "school event"
        locations: string[];        // "Riverside Elementary", "home"
        recurringPatterns: string[];// "soccer practice every Tuesday 4pm"
    };
}

export const PERSONAS: PersonaConfig[] = [
    {
        id: 'busy-parent',
        name: 'Sarah Mitchell',
        description: `
Sarah is a 38-year-old part-time marketing consultant and primary caregiver for two kids:
Emma (age 8, Grade 3) and Max (age 5, kindergarten). Her husband James works long hours in finance.
Sarah manages school pickups, after-school activities, household admin, and her part-time client work.
Her life is dominated by the kids' schedules, recurring tasks (groceries, appointments, forms),
and the occasional personal goal she never quite gets to. She lives in the suburbs with a 15-minute
school commute. Her social graph: family (James, Emma, Max, her mother Carol), school network
(teacher Ms. Davies, coach Pete), neighbours (the Garcias next door), and two close friends (Priya, Jess).
`.trim(),
        entityMix: { tasks: 85, events: 65, people: 35, notes: 45, goals: 25, contextEntities: 45 },
        spine: {
            people: [
                'James Mitchell (husband)',
                'Emma Mitchell (daughter, age 8)',
                'Max Mitchell (son, age 5)',
                'Carol Hayes (mother)',
                'Ms. Davies (Emma\'s teacher)',
                'Coach Pete (soccer coach)',
                'Priya Sharma (close friend)',
                'Jess O\'Brien (close friend)',
                'Maria Garcia (neighbour)',
                'Dr. Patel (family GP)',
            ],
            goals: [
                'Get Emma into the gifted reading programme by September 2026',
                'Plan a family holiday to Portugal in August 2026',
                'Lose 8kg before summer',
                'Finish the Riverside client proposal by end of May 2026',
                'Get Max settled into Grade 1 transition by June 2026',
            ],
            contextTypes: ['soccer game', 'school event', 'medical appointment', 'client project'],
            locations: [
                'Riverside Elementary School',
                'Oakfield Soccer Park',
                'Dr. Patel\'s clinic',
                'home',
                'Priya\'s house',
            ],
            recurringPatterns: [
                'Soccer practice every Tuesday and Thursday 4–5:30pm at Oakfield',
                'School pickup Monday–Friday 3:15pm',
                'Weekly grocery shop Saturday morning',
                'Monthly GP check on Max\'s asthma',
            ],
        },
    },

    {
        id: 'ceo',
        name: 'David Chen',
        description: `
David is a 45-year-old CEO of Vantix, a 55-person B2B SaaS company doing $8M ARR.
He raised a Series A 18 months ago and is now preparing a Series B. His day is a mix of
strategy, investor relations, board management, 1:1s with direct reports, and the occasional
deep-work block. He travels frequently (SF, NYC, London). Direct reports: CTO (Mei), VP Sales (Ryan),
VP Marketing (Clara), CFO (Ben), Head of CS (Anita). Board: lead investor Marcus Webb (Apex Ventures),
independent director Harriet Ford. Key investors: Apex Ventures, Brightshore Capital.
His goals are all company-scale: ARR growth, Series B close, product milestones.
Personal: married to Lin, two teenage kids, tries to protect Sunday as family time.
`.trim(),
        entityMix: { tasks: 70, events: 65, people: 50, notes: 55, goals: 30, contextEntities: 30 },
        spine: {
            people: [
                'Mei Zhang (CTO, direct report)',
                'Ryan O\'Sullivan (VP Sales, direct report)',
                'Clara Voss (VP Marketing, direct report)',
                'Ben Nakamura (CFO, direct report)',
                'Anita Rao (Head of Customer Success, direct report)',
                'Marcus Webb (lead investor, Apex Ventures)',
                'Harriet Ford (independent board director)',
                'Lin Chen (wife)',
                'Sarah Bloom (executive assistant)',
                'Tom Reilly (Series B advisor)',
            ],
            goals: [
                'Close Series B ($25M) by Q3 2026',
                'Reach $12M ARR by end of 2026',
                'Ship Vantix 3.0 product platform by August 2026',
                'Hire VP Engineering by June 2026',
                'Achieve NPS > 50 by Q4 2026',
            ],
            contextTypes: ['board meeting', '1:1', 'investor update', 'product review'],
            locations: [
                'Vantix HQ — San Francisco',
                'Apex Ventures office — Palo Alto',
                'NYC (investor meetings)',
                'London (enterprise client)',
            ],
            recurringPatterns: [
                'Weekly leadership team standup Monday 9am',
                'Bi-weekly board update prep',
                'Monthly all-hands last Friday of month',
                '1:1 with each direct report every two weeks',
            ],
        },
    },

    {
        id: 'consultant',
        name: 'Alex Rivera',
        description: `
Alex is a 33-year-old independent management consultant specialising in operational efficiency
for mid-market manufacturing firms. She runs 3–4 client engagements concurrently, each at a
different stage (scoping, active delivery, wrap-up). She travels 2–3 days per week to client sites.
Her work is deadline-driven and billable-hour conscious. Clients: Meridian Industrial (active,
8-week engagement), Forgepoint Manufacturing (scoping phase), Halcyon Logistics (wrap-up, invoice due).
Home base: Chicago. She works alone but subcontracts to two specialists: Jamie (data analyst),
Preet (process modeller). Personal: partner Sam, no kids, keen runner.
`.trim(),
        entityMix: { tasks: 85, events: 65, people: 40, notes: 55, goals: 30, contextEntities: 25 },
        spine: {
            people: [
                'Tom Hargreaves (MD, Meridian Industrial — primary client contact)',
                'Claire Bouchard (COO, Meridian Industrial)',
                'Frank Ozorio (CEO, Forgepoint Manufacturing)',
                'Linda Park (CFO, Halcyon Logistics)',
                'Jamie Kowalski (subcontractor, data analyst)',
                'Preet Sandhu (subcontractor, process modeller)',
                'Sam Torres (partner)',
                'Rachel Ng (accountant)',
                'Chris Dunn (fellow consultant, referral network)',
            ],
            goals: [
                'Deliver Meridian phase 1 report by May 28 2026',
                'Close Forgepoint engagement by June 15 2026',
                'Collect Halcyon final invoice ($18,400) by May 20 2026',
                'Hit $240K revenue for 2026',
                'Publish one thought-leadership article per quarter',
            ],
            contextTypes: ['client engagement', 'site visit', 'deliverable'],
            locations: [
                'Meridian Industrial — Detroit',
                'Forgepoint Manufacturing — Cleveland',
                'Halcyon Logistics — Indianapolis',
                'home office — Chicago',
            ],
            recurringPatterns: [
                'Weekly status call with Meridian every Monday 10am',
                'Forgepoint scoping sessions Wednesdays',
                'Friday afternoon admin: invoicing, time-tracking, email catch-up',
                'Monthly revenue review with Rachel',
            ],
        },
    },
];
