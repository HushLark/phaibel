import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import {
    loadConfig,
    setApiKey,
    setCapabilityModel,
    removeCapabilityOverride,
    getApiKey,
    getEffectiveConfig,
    getConfiguredProviders,
    PROVIDER_MODELS,
} from '../config.js';
import { listProviders } from '../llm/providers/index.js';
import { LLM_CAPABILITIES, type LLMCapability } from '../schemas/index.js';

export const configCommand = new Command('config')
    .description('Manage configuration and secrets');

// Default action - show effective config
configCommand
    .action(async () => {
        const [effective, configuredProviders] = await Promise.all([
            getEffectiveConfig(),
            getConfiguredProviders(),
        ]);
        const config = await loadConfig();

        console.log(chalk.cyan('\n  Phaibel Configuration\n'));

        // Provider mode
        const usingSynaptic = configuredProviders.includes('synaptic');
        if (usingSynaptic) {
            console.log(chalk.bold('Provider:') + chalk.green('  Phaibel Account') + chalk.gray('  (run `phaibel logout` to switch to local)'));
        } else {
            console.log(chalk.bold('Provider:') + chalk.cyan('  Local (BYOK)') + chalk.gray('  (run `phaibel login` to connect a Phaibel account)'));
        }
        console.log('');

        // Local API keys (only shown in local mode)
        if (!usingSynaptic) {
            console.log(chalk.bold('API Keys:'));
            const knownProviders = ['openai', 'anthropic', 'google', 'deepseek'];
            for (const provider of knownProviders) {
                const configured = configuredProviders.includes(provider);
                const tick = configured ? chalk.green('✓') : chalk.gray('○');
                const hint = configured ? '' : chalk.gray('  run: phaibel config add-provider ' + provider);
                console.log(`  ${tick} ${provider}${hint}`);
            }
            console.log('');
        }

        // Effective capability → model mapping
        console.log(chalk.bold('Effective Capability → Model:'));
        const capDescriptions: Record<string, string> = {
            reason: 'complex reasoning',
            chat: 'conversation',
            summarize: 'summarising',
            categorize: 'classification',
            format: 'text formatting',
            embed: 'embeddings',
        };
        for (const cap of LLM_CAPABILITIES) {
            const mapping = effective[cap];
            const override = config.capabilityMapping[cap];
            if (mapping) {
                const overrideTag = override ? chalk.yellow(' [override]') : '';
                console.log(
                    `  ${chalk.bold(cap.padEnd(12))} ${chalk.gray(capDescriptions[cap].padEnd(18))} ${mapping.provider}/${mapping.model}${overrideTag}`
                );
            } else {
                const hint = cap === 'embed' ? chalk.gray(' (requires OpenAI — Anthropic has no embedding model)') : '';
                console.log(
                    `  ${chalk.bold(cap.padEnd(12))} ${chalk.gray(capDescriptions[cap].padEnd(18))} ${chalk.red('no provider configured')}${hint}`
                );
            }
        }
        console.log('');

        if (Object.keys(config.capabilityMapping).length > 0) {
            console.log(chalk.gray('  Capabilities marked [override] have manual settings. Run `phaibel config reset-capability <cap>` to restore auto-selection.'));
            console.log('');
        }
    });

// Add provider
configCommand
    .command('add-provider <name>')
    .description('Add or update an API key (openai, anthropic)')
    .action(async (name: string) => {
        const knownProviders = Object.keys(PROVIDER_MODELS);
        if (!knownProviders.includes(name)) {
            console.log(chalk.yellow(`\n"${name}" is not a recognised built-in provider.`));
            console.log(chalk.gray(`Known providers: ${knownProviders.join(', ')}`));
            const { proceed } = await inquirer.prompt([{
                type: 'confirm', name: 'proceed',
                message: 'Add it anyway as a custom provider?',
                default: false,
            }]);
            if (!proceed) { console.log(chalk.gray('Cancelled.')); return; }
        }

        const existing = await getApiKey(name);
        if (existing) {
            const { confirm } = await inquirer.prompt([{
                type: 'confirm', name: 'confirm',
                message: `API key for ${name} already exists. Replace it?`,
                default: false,
            }]);
            if (!confirm) { console.log(chalk.gray('Cancelled.')); return; }
        }

        const { apiKey } = await inquirer.prompt([{
            type: 'password', name: 'apiKey',
            message: `Enter ${name} API key:`,
            mask: '*',
            validate: (input: string) => input.length > 0 || 'API key is required',
        }]);

        await setApiKey(name, apiKey);
        console.log(chalk.green(`\n✓ ${name} API key saved, sir!\n`));

        // Show what Phaibel will use with this provider
        const providerModels = PROVIDER_MODELS[name];
        if (providerModels) {
            console.log(chalk.bold(`Phaibel will automatically use these ${name} models:\n`));
            for (const [cap, model] of Object.entries(providerModels)) {
                console.log(`  ${chalk.gray(cap.padEnd(12))} ${model}`);
            }
            console.log('');
            console.log(chalk.gray('Run `phaibel config` to see the full effective configuration.'));
            console.log('');
        }
    });

// Override a capability (advanced)
configCommand
    .command('set-capability <capability> <provider> <model>')
    .description('Advanced: override the auto-selected model for a capability')
    .action(async (capability: string, provider: string, model: string) => {
        if (!LLM_CAPABILITIES.includes(capability as LLMCapability)) {
            console.log(chalk.red(`Unknown capability: ${capability}`));
            console.log(chalk.gray(`Valid capabilities: ${LLM_CAPABILITIES.join(', ')}`));
            return;
        }
        await setCapabilityModel(capability as LLMCapability, provider, model);
        console.log(chalk.green(`✓ Capability "${capability}" will now use ${provider}/${model}, sir!`));
        console.log(chalk.gray(`  Run 'phaibel config reset-capability ${capability}' to restore auto-selection.`));
    });

// Reset a capability override back to auto-selection
configCommand
    .command('reset-capability <capability>')
    .description('Remove a manual override and restore auto-selection for a capability')
    .action(async (capability: string) => {
        if (!LLM_CAPABILITIES.includes(capability as LLMCapability)) {
            console.log(chalk.red(`Unknown capability: ${capability}`));
            console.log(chalk.gray(`Valid capabilities: ${LLM_CAPABILITIES.join(', ')}`));
            return;
        }
        await removeCapabilityOverride(capability as LLMCapability);
        console.log(chalk.green(`✓ "${capability}" will now be auto-selected based on your configured providers, sir!`));
    });

// List capabilities
configCommand
    .command('list-capabilities')
    .description('List LLM capability categories')
    .action(() => {
        console.log(chalk.cyan('\n🧠 LLM Capabilities:\n'));

        const descriptions: Record<string, string> = {
            reason: 'Complex thinking, multi-step logic',
            summarize: 'Condensing, prioritizing info',
            categorize: 'Classification, tagging',
            format: 'Markdown, text cleanup',
            chat: 'General conversation',
            embed: 'Vector embeddings',
        };

        for (const cap of LLM_CAPABILITIES) {
            console.log(`  ${chalk.bold(cap)}: ${chalk.gray(descriptions[cap])}`);
        }
        console.log('');
    });

// List providers
configCommand
    .command('list-providers')
    .description('List supported providers and their models')
    .action(async () => {
        const configuredProviders = await getConfiguredProviders();

        console.log(chalk.cyan('\n  Supported Providers\n'));

        for (const provider of listProviders()) {
            const configured = configuredProviders.includes(provider);
            const tick = configured ? chalk.green('✓ configured') : chalk.gray('○ not configured');
            console.log(`  ${chalk.bold(provider)}  ${tick}`);
            const models = PROVIDER_MODELS[provider];
            if (models) {
                for (const [cap, model] of Object.entries(models)) {
                    console.log(`    ${chalk.gray(cap.padEnd(12))} ${model}`);
                }
            }
            console.log('');
        }

        console.log(chalk.gray('Add a key: phaibel config add-provider <name>'));
        console.log('');
    });

// Set user name
configCommand
    .command('set-name <name>')
    .description('Set your name for personalized responses')
    .action(async (name: string) => {
        const { setUserName } = await import('../state/manager.js');
        await setUserName(name);
        console.log(chalk.green(`\n✓ You will be called "${name}" from now on!`));
    });

export default configCommand;

