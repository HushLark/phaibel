import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { loadSecrets, saveSecrets } from '../config.js';

const DEFAULT_ENDPOINT = 'https://synaptic.hushlark.ai';

export const loginCommand = new Command('login')
    .description('Connect a Phaibel account (uses Synaptic for all LLM calls)')
    .action(async () => {
        console.log(chalk.cyan('\n  Connect Phaibel Account\n'));
        console.log(chalk.gray('  Your API token routes requests through Synaptic,'));
        console.log(chalk.gray('  which selects models based on your plan.\n'));

        const { endpoint } = await inquirer.prompt([{
            type: 'input',
            name: 'endpoint',
            message: 'Synaptic endpoint:',
            default: DEFAULT_ENDPOINT,
        }]);

        const { token } = await inquirer.prompt([{
            type: 'password',
            name: 'token',
            message: 'API token:',
            mask: '*',
            validate: (v: string) => v.length > 0 || 'Token is required',
        }]);

        const secrets = await loadSecrets();
        secrets.providers['synaptic'] = { apiKey: token, endpoint };
        await saveSecrets(secrets);

        console.log(chalk.green(`\n✓ Connected to ${endpoint}`));
        console.log(chalk.gray('  Phaibel will now use your account for all LLM calls.'));
        console.log(chalk.gray('  Run `phaibel config` to confirm.'));
        console.log(chalk.gray('  Run `phaibel logout` to switch back to local API keys.\n'));
    });

export const logoutCommand = new Command('logout')
    .description('Disconnect Phaibel account and revert to local API keys')
    .action(async () => {
        const secrets = await loadSecrets();
        if (!secrets.providers['synaptic']) {
            console.log(chalk.gray('\nNo Phaibel account connected.\n'));
            return;
        }
        delete secrets.providers['synaptic'];
        await saveSecrets(secrets);
        console.log(chalk.green('\n✓ Logged out. Using local API keys.\n'));
    });
