#!/usr/bin/env npx tsx
// ─────────────────────────────────────────────────────────────────────────────
// Synthetic vault data generator
//
// Usage:
//   npx tsx tests/synthetic/generate.ts                    # all personas
//   npx tsx tests/synthetic/generate.ts busy-parent        # one persona
//   npx tsx tests/synthetic/generate.ts ceo --batch 20     # custom batch size
//
// Output: tests/synthetic/output/<persona-id>/  (markdown files)
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getModelForCapability } from '../../src/llm/router.js';
import { cleanJson } from '../../src/utils/json-parser.js';
import { PERSONAS, type PersonaConfig } from './persona-configs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_ROOT = path.join(__dirname, 'output');
const TODAY = '2026-05-12';
const DEFAULT_BATCH_SIZE = 15;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface GeneratedEntity {
    path: string;                          // relative path e.g. "tasks/dentist.md"
    frontmatter: Record<string, unknown>;
    body: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseEntityArray(raw: string): GeneratedEntity[] {
    const cleaned = cleanJson(raw);
    // Handle both bare array and wrapped { entities: [...] }
    let parsed: unknown;
    try {
        parsed = JSON.parse(cleaned);
    } catch {
        // Strip preamble text before the first [
        const start = cleaned.indexOf('[');
        if (start < 0) throw new Error('No JSON array found in response');
        let depth = 0, inStr = false, esc = false;
        for (let i = start; i < cleaned.length; i++) {
            const ch = cleaned[i];
            if (esc) { esc = false; continue; }
            if (ch === '\\' && inStr) { esc = true; continue; }
            if (ch === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (ch === '[') depth++;
            if (ch === ']') { depth--; if (depth === 0) { parsed = JSON.parse(cleaned.slice(start, i + 1)); break; } }
        }
    }
    if (Array.isArray(parsed)) return parsed as GeneratedEntity[];
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).entities)) {
        return (parsed as { entities: GeneratedEntity[] }).entities;
    }
    throw new Error('Response is not an array of entities');
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────────────────────

function spinePrompt(persona: PersonaConfig): string {
    return `You are generating synthetic personal assistant vault data for a benchmark test.

PERSONA: ${persona.name}
${persona.description}

TODAY: ${TODAY}

Generate the SPINE — the foundational entities that all other entries will reference.
Include:
- All key people (${persona.spine.people.length} people listed below)
- All goals (${persona.spine.goals.length} goals listed below)
- The main context types as sample entities (3–4 per context type)
- A handful of anchor events (recurring meetings, key upcoming dates)

People to include:
${persona.spine.people.map(p => `  - ${p}`).join('\n')}

Goals to include:
${persona.spine.goals.map(g => `  - ${g}`).join('\n')}

Context types to include (create 3–4 sample entities of each):
${persona.spine.contextTypes.map(ct => `  - ${ct}`).join('\n')}

Recurring patterns to reflect:
${persona.spine.recurringPatterns.map(r => `  - ${r}`).join('\n')}

Return a JSON array of entities. Each entity:
{
  "path": "people/james-mitchell.md",        // folder reflects type: people/, tasks/, events/, notes/, goals/
  "frontmatter": {
    "title": "James Mitchell",
    "created": "2026-01-15",                 // ISO date string
    "tags": ["family", "husband"],           // array of strings
    // include type-appropriate fields: dueDate, status, startDate, endDate, priority, person, location, etc.
  },
  "body": "One to three sentences of realistic body text."
}

Rules:
- Dates must be ISO strings (YYYY-MM-DD or YYYY-MM-DDTHH:MM)
- Mix of past, present, and future dates relative to ${TODAY}
- tags are lowercase, hyphenated
- Status values for tasks: "open" | "in-progress" | "done" | "blocked"
- People entities use fields: relationship, email (optional), phone (optional)
- Goal entities use fields: status ("active"|"done"), targetDate
- Event entities use fields: startDate, endDate (optional), location (optional)
- Aim for 30–35 entities total in this spine batch

Return ONLY the JSON array. No preamble, no explanation.`;
}

function bulkPrompt(
    persona: PersonaConfig,
    spineSummary: string,
    batchIndex: number,
    batchSize: number,
    typeFocus: string,
): string {
    return `You are generating synthetic personal assistant vault data for a benchmark test.

PERSONA: ${persona.name}
${persona.description}

TODAY: ${TODAY}

ALREADY GENERATED (spine — use these names/ids for cross-references):
${spineSummary}

BATCH ${batchIndex + 1} — focus on: ${typeFocus}

Generate exactly ${batchSize} new entities. Do NOT duplicate entities from the spine.
Use the spine people, goals, and context types as cross-references in tags and body text.

Vary temporal distribution:
- ~30% past (done tasks, past events, completed goals)
- ~40% near-present (this week ± 2 weeks)
- ~30% future (upcoming, planned)

Include realistic detail: specific names, realistic durations, real-feeling notes.
Exercise the relevance signals:
- Temporal: use specific dates, deadlines, recurrence
- Spatial: mention locations from the persona's world
- Goal alignment: tag tasks/events to active goals
- Social: reference people from the spine by name
- Behavioral: some entities should feel "frequently touched" (add a note about it)

Return a JSON array of exactly ${batchSize} entities:
{
  "path": "tasks/renew-car-insurance.md",
  "frontmatter": { "title": "...", "created": "...", "tags": [...], ... },
  "body": "..."
}

Return ONLY the JSON array. No preamble.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Spine summary (condensed for passing to bulk batches)
// ─────────────────────────────────────────────────────────────────────────────

function buildSpineSummary(entities: GeneratedEntity[]): string {
    return entities
        .map(e => {
            const fm = e.frontmatter;
            const tags = Array.isArray(fm.tags) ? (fm.tags as string[]).join(', ') : '';
            return `- [${e.path}] "${fm.title}" ${tags ? `(${tags})` : ''}`;
        })
        .join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// File writing
// ─────────────────────────────────────────────────────────────────────────────

function toYaml(obj: Record<string, unknown>, indent = ''): string {
    return Object.entries(obj)
        .map(([k, v]) => {
            if (Array.isArray(v)) {
                if (v.length === 0) return `${indent}${k}: []`;
                return `${indent}${k}:\n${v.map(item => `${indent}  - ${item}`).join('\n')}`;
            }
            if (v === null || v === undefined) return null;
            if (typeof v === 'string' && (v.includes(':') || v.includes('#') || v.includes("'"))) {
                return `${indent}${k}: "${v.replace(/"/g, '\\"')}"`;
            }
            return `${indent}${k}: ${v}`;
        })
        .filter(Boolean)
        .join('\n');
}

function writeEntity(entity: GeneratedEntity, outputDir: string): void {
    const fullPath = path.join(outputDir, entity.path);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    const yaml = toYaml(entity.frontmatter);
    const content = `---\n${yaml}\n---\n\n${entity.body}\n`;
    fs.writeFileSync(fullPath, content, 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch type schedule — what to focus each bulk batch on
// ─────────────────────────────────────────────────────────────────────────────

function batchFocusSchedule(mix: PersonaConfig['entityMix']): string[] {
    const schedule: string[] = [];
    const add = (focus: string, count: number) => {
        for (let i = 0; i < count; i++) schedule.push(focus);
    };

    // Distribute batches proportionally to entity mix
    // Each batch is DEFAULT_BATCH_SIZE entities
    const batchSize = DEFAULT_BATCH_SIZE;
    add(`tasks (open, in-progress, blocked tasks — specific and actionable)`,
        Math.round(mix.tasks / batchSize));
    add(`completed/done tasks and past events (realistic history)`,
        Math.round((mix.tasks * 0.3 + mix.events * 0.4) / batchSize));
    add(`upcoming events and appointments (with specific times and locations)`,
        Math.round(mix.events * 0.6 / batchSize));
    add(`meeting notes and research notes (realistic prose bodies)`,
        Math.round(mix.notes / batchSize));
    add(`goals and context-type entities (${mix.contextEntities} context entities)`,
        Math.round((mix.goals + mix.contextEntities) / batchSize));

    return schedule;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main generator
// ─────────────────────────────────────────────────────────────────────────────

async function generatePersona(persona: PersonaConfig, batchSize: number): Promise<void> {
    const outputDir = path.join(OUTPUT_ROOT, persona.id);
    if (fs.existsSync(outputDir)) {
        fs.rmSync(outputDir, { recursive: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });

    const llm = await getModelForCapability('reason');
    let totalWritten = 0;
    const allEntities: GeneratedEntity[] = [];

    // Phase 1: Spine
    console.log(`  [${persona.id}] Phase 1: generating spine…`);
    try {
        const raw = await llm.chat(
            [{ role: 'user', content: spinePrompt(persona) }],
            { maxTokens: 6000, temperature: 0.8 },
        );
        const entities = parseEntityArray(raw);
        for (const entity of entities) {
            writeEntity(entity, outputDir);
            allEntities.push(entity);
            totalWritten++;
        }
        console.log(`  [${persona.id}] Spine: wrote ${entities.length} entities`);
    } catch (e) {
        console.error(`  [${persona.id}] Spine failed: ${e}`);
        return;
    }

    const spineSummary = buildSpineSummary(allEntities);
    const target = Object.values(persona.entityMix).reduce((a, b) => a + b, 0);
    const schedule = batchFocusSchedule(persona.entityMix);

    // Phase 2: Bulk batches
    for (let i = 0; i < schedule.length && totalWritten < target; i++) {
        const remaining = target - totalWritten;
        const thisBatch = Math.min(batchSize, remaining);
        const focus = schedule[i];

        console.log(`  [${persona.id}] Batch ${i + 1}/${schedule.length}: ${focus.split('(')[0].trim()} (${thisBatch} entities)…`);

        try {
            const raw = await llm.chat(
                [{ role: 'user', content: bulkPrompt(persona, spineSummary, i, thisBatch, focus) }],
                { maxTokens: 5000, temperature: 0.85 },
            );
            const entities = parseEntityArray(raw);
            for (const entity of entities) {
                writeEntity(entity, outputDir);
                allEntities.push(entity);
                totalWritten++;
            }
            console.log(`  [${persona.id}] Batch ${i + 1}: wrote ${entities.length} (total: ${totalWritten}/${target})`);
        } catch (e) {
            console.error(`  [${persona.id}] Batch ${i + 1} failed: ${e}`);
            // Continue — one bad batch shouldn't abort the run
        }
    }

    // Write a manifest for use by test queries
    const manifest = {
        personaId: persona.id,
        personaName: persona.name,
        generatedAt: new Date().toISOString(),
        totalEntities: totalWritten,
        paths: allEntities.map(e => e.path),
    };
    fs.writeFileSync(
        path.join(outputDir, '_manifest.json'),
        JSON.stringify(manifest, null, 2),
    );

    console.log(`  [${persona.id}] Done — ${totalWritten} entities written to ${outputDir}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI entry point
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const batchSizeArg = args.indexOf('--batch');
    const batchSize = batchSizeArg >= 0 ? parseInt(args[batchSizeArg + 1], 10) : DEFAULT_BATCH_SIZE;
    const personaFilter = args.filter(a => !a.startsWith('--') && !/^\d+$/.test(a));

    const personas = personaFilter.length > 0
        ? PERSONAS.filter(p => personaFilter.includes(p.id))
        : PERSONAS;

    if (personas.length === 0) {
        console.error(`No matching personas. Available: ${PERSONAS.map(p => p.id).join(', ')}`);
        process.exit(1);
    }

    console.log(`Generating ${personas.length} persona(s) with batch size ${batchSize}`);
    console.log(`Output: ${OUTPUT_ROOT}\n`);

    for (const persona of personas) {
        const target = Object.values(persona.entityMix).reduce((a, b) => a + b, 0);
        console.log(`► ${persona.name} (${persona.id}) — target: ${target} entities`);
        await generatePersona(persona, batchSize);
        console.log();
    }

    console.log('Generation complete.');
}

main().catch(e => { console.error(e); process.exit(1); });
