import { z } from 'zod';
// Frontmatter schema for markdown files
export const FrontmatterSchema = z.object({
    title: z.string(),
    created: z.string(),
    modified: z.string().optional(),
    tags: z.array(z.string()).default([]),
    status: z.enum(['active', 'done', 'blocked', 'archived']).optional(),
});
// Provider secrets
export const ProviderSecretSchema = z.object({
    apiKey: z.string(),
});
export const SecretsSchema = z.object({
    providers: z.record(z.string(), ProviderSecretSchema),
});
// LLM Capability categories
export const LLMCapabilitySchema = z.enum([
    'reason', // Complex thinking, multi-step logic
    'summarize', // Condensing, prioritizing info
    'categorize', // Classification, tagging
    'format', // Markdown, text cleanup
    'chat', // General conversation
    'embed', // Vector embeddings
]);
export const LLM_CAPABILITIES = LLMCapabilitySchema.options;
// Capability-to-model mapping
export const CapabilityModelMappingSchema = z.object({
    provider: z.string(),
    model: z.string(),
});
// Config — capabilityMapping holds only manual overrides; auto-resolution fills the rest.
export const ConfigSchema = z.object({
    capabilityMapping: z.record(LLMCapabilitySchema, CapabilityModelMappingSchema).default({}),
    defaultProvider: z.string().default('openai'),
});
// State
export const StateSchema = z.object({
    lastUsed: z.string().optional(),
    userName: z.string().optional(),
    agentName: z.string().optional(),
    personality: z.enum(['butler', 'rockstar', 'executive', 'friend', 'pip', 'emm']).optional(),
    honorific: z.string().optional(),
    gender: z.enum(['male', 'female', 'other']).optional(),
    workType: z.string().optional(),
    familySituation: z.string().optional(),
    hasCar: z.boolean().optional(),
    cityLive: z.string().optional(),
    cityWork: z.string().optional(),
    personalCalUrl: z.string().optional(),
    workCalUrl: z.string().optional(),
    interviewComplete: z.boolean().optional(),
});
// Tool types
export const ToolTypeSchema = z.enum(['deterministic', 'ai']);
export const ToolSchema = z.object({
    name: z.string(),
    description: z.string(),
    type: ToolTypeSchema,
    capability: LLMCapabilitySchema.optional(), // Which capability this tool uses
});
// Standard tags
export const StandardTags = [
    'todo',
    'note',
    'research',
    'meeting',
    'idea',
    'blocked',
    'done',
    'context',
];
