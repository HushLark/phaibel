import { promises as fs } from 'fs';
import { SecretsSchema, ConfigSchema, LLM_CAPABILITIES, type Secrets, type Config, type LLMCapability, type CapabilityModelMapping } from './schemas/index.js';
import { debug } from './utils/debug.js';
import { SYSTEM_DIR, SECRETS_PATH, getConfigPath, getVaultConfigDir } from './paths.js';

// Built-in knowledge: the best model per provider per capability.
// Users only need to add their API key — the agent picks the right model automatically.
//
// OpenAI pricing notes:
//   gpt-4o:       ~$2.50/1M input, $10/1M output  (reasoning & chat)
//   gpt-4o-mini:  ~$0.15/1M input, $0.60/1M output (fast tasks, 15x cheaper)
//   text-embedding-3-small: ~$0.02/1M tokens
//
// Anthropic pricing notes:
//   claude-opus-4-6:          most capable, best reasoning
//   claude-sonnet-4-6:        excellent balance of quality & cost
//   claude-haiku-4-5-20251001: fastest & cheapest for simple tasks
export const PROVIDER_MODELS: Record<string, Partial<Record<LLMCapability, string>>> = {
    openai: {
        reason: 'gpt-4o',
        summarize: 'gpt-4o-mini',
        categorize: 'gpt-4o-mini',
        format: 'gpt-4o-mini',
        chat: 'gpt-4o',
        embed: 'text-embedding-3-small',
    },
    anthropic: {
        reason: 'claude-sonnet-4-6',
        summarize: 'claude-haiku-4-5-20251001',
        categorize: 'claude-haiku-4-5-20251001',
        format: 'claude-haiku-4-5-20251001',
        chat: 'claude-sonnet-4-6',
        // embed: not supported by Anthropic
    },
};

// Preferred provider order per capability when multiple providers are configured.
// First available provider with a model for the capability wins.
const CAPABILITY_PREFERRED_PROVIDERS: Record<LLMCapability, string[]> = {
    reason: ['anthropic', 'openai'],      // Claude Sonnet is fast and excellent at structured reasoning
    chat: ['anthropic', 'openai'],        // Claude Sonnet has the best personality for the agent
    summarize: ['openai', 'anthropic'],   // GPT-4o-mini is very cost-effective for this
    categorize: ['openai', 'anthropic'],  // GPT-4o-mini is very cost-effective for this
    format: ['openai', 'anthropic'],      // GPT-4o-mini is very cost-effective for this
    embed: ['openai'],                    // Anthropic does not support embeddings
};

// Config stores only explicit user overrides; everything else is auto-resolved.
const DEFAULT_CONFIG: Config = {
    capabilityMapping: {},
    defaultProvider: 'openai',
};

const DEFAULT_SECRETS: Secrets = {
    providers: {},
};

async function ensureSystemDir(): Promise<void> {
    await fs.mkdir(SYSTEM_DIR, { recursive: true });
}

async function ensureVaultConfigDir(): Promise<void> {
    await fs.mkdir(await getVaultConfigDir(), { recursive: true });
}

export async function loadSecrets(): Promise<Secrets> {
    try {
        await ensureSystemDir();
        const data = await fs.readFile(SECRETS_PATH, 'utf-8');
        return SecretsSchema.parse(JSON.parse(data));
    } catch (err) {
        debug('config', err);
        return DEFAULT_SECRETS;
    }
}

export async function saveSecrets(secrets: Secrets): Promise<void> {
    await ensureSystemDir();
    await fs.writeFile(SECRETS_PATH, JSON.stringify(secrets, null, 2));
}

export async function loadConfig(): Promise<Config> {
    try {
        const configPath = await getConfigPath();
        const data = await fs.readFile(configPath, 'utf-8');
        return ConfigSchema.parse(JSON.parse(data));
    } catch (err) {
        debug('config', err);
        return DEFAULT_CONFIG;
    }
}

export async function saveConfig(config: Config): Promise<void> {
    await ensureVaultConfigDir();
    const configPath = await getConfigPath();
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

export async function getApiKey(provider: string): Promise<string | null> {
    const secrets = await loadSecrets();
    return secrets.providers[provider]?.apiKey ?? null;
}

export async function setApiKey(provider: string, apiKey: string): Promise<void> {
    const secrets = await loadSecrets();
    secrets.providers[provider] = { apiKey };
    await saveSecrets(secrets);
}

// Returns the effective provider+model for a capability.
// Checks explicit user overrides first, then auto-resolves based on configured providers.
export async function getCapabilityModel(capability: LLMCapability): Promise<CapabilityModelMapping | null> {
    const [config, secrets] = await Promise.all([loadConfig(), loadSecrets()]);

    // 1. Explicit user override takes priority
    const override = config.capabilityMapping[capability];
    if (override) return override;

    // 2. Auto-resolve: try preferred providers in order
    const available = new Set(Object.keys(secrets.providers));
    for (const provider of CAPABILITY_PREFERRED_PROVIDERS[capability]) {
        const model = PROVIDER_MODELS[provider]?.[capability];
        if (model && available.has(provider)) {
            return { provider, model };
        }
    }

    return null;
}

// Returns the effective mapping for every capability — useful for display.
export async function getEffectiveConfig(): Promise<Record<LLMCapability, CapabilityModelMapping | null>> {
    const result = {} as Record<LLMCapability, CapabilityModelMapping | null>;
    await Promise.all(
        LLM_CAPABILITIES.map(async (cap) => {
            result[cap] = await getCapabilityModel(cap);
        })
    );
    return result;
}

export async function setCapabilityModel(capability: LLMCapability, provider: string, model: string): Promise<void> {
    const config = await loadConfig();
    config.capabilityMapping[capability] = { provider, model };
    await saveConfig(config);
}

export async function removeCapabilityOverride(capability: LLMCapability): Promise<void> {
    const config = await loadConfig();
    delete config.capabilityMapping[capability];
    await saveConfig(config);
}

// Returns the list of providers that have an API key configured.
export async function getConfiguredProviders(): Promise<string[]> {
    const secrets = await loadSecrets();
    return Object.keys(secrets.providers);
}

export { SECRETS_PATH };
