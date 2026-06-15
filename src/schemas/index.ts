import { z } from 'zod';

// Frontmatter schema for markdown files
export const FrontmatterSchema = z.object({
    title: z.string(),
    created: z.string(),
    modified: z.string().optional(),
    status: z.enum(['active', 'done', 'blocked', 'archived']).optional(),
});

export type Frontmatter = z.infer<typeof FrontmatterSchema>;

// Provider secrets
export const ProviderSecretSchema = z.object({
    apiKey: z.string(),
    endpoint: z.string().optional(),
    refreshToken: z.string().optional(),
    userId: z.string().optional(),
});

export const SecretsSchema = z.object({
    providers: z.record(z.string(), ProviderSecretSchema),
    jwtSecret: z.string().optional(),
    stripeSecretKey: z.string().optional(),
    stripeWebhookSecret: z.string().optional(),
    stripePrices: z.object({
        pro_monthly: z.string().optional(),
        pro_annual: z.string().optional(),
    }).optional(),
});

export type Secrets = z.infer<typeof SecretsSchema>;

// LLM Capability categories
export const LLMCapabilitySchema = z.enum([
    'reason',      // Complex thinking, multi-step logic
    'summarize',   // Condensing, prioritizing info
    'categorize',  // Classification, tagging
    'format',      // Markdown, text cleanup
    'chat',        // General conversation
    'embed',       // Vector embeddings
]);

export type LLMCapability = z.infer<typeof LLMCapabilitySchema>;

export const LLM_CAPABILITIES = LLMCapabilitySchema.options;

// Capability-to-model mapping
export const CapabilityModelMappingSchema = z.object({
    provider: z.string(),
    model: z.string(),
});

export type CapabilityModelMapping = z.infer<typeof CapabilityModelMappingSchema>;

// Config — capabilityMapping holds only manual overrides; auto-resolution fills the rest.
export const ConfigSchema = z.object({
    capabilityMapping: z.record(LLMCapabilitySchema, CapabilityModelMappingSchema).default({}),
    defaultProvider: z.string().default('openai'),
});

export type Config = z.infer<typeof ConfigSchema>;

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
    chatLogRetentionDays: z.number().int().min(1).optional(),
});

export type State = z.infer<typeof StateSchema>;

// Tool types
export const ToolTypeSchema = z.enum(['deterministic', 'ai']);

export const ToolSchema = z.object({
    name: z.string(),
    description: z.string(),
    type: ToolTypeSchema,
    capability: LLMCapabilitySchema.optional(),  // Which capability this tool uses
});

export type ToolDefinition = z.infer<typeof ToolSchema>;

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
] as const;

export type StandardTag = typeof StandardTags[number];
