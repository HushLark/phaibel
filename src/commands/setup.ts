import { Command } from 'commander';
import { getResponse, refreshResponseCache } from '../responses.js';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { loadState, saveState, getUserName, getUserGender, ensureSelfPerson } from '../state/manager.js';

export const setupCommand = new Command('setup')
    .description('Update your name and preferences')
    .action(async () => {
        const currentName = await getUserName();
        const currentGender = await getUserGender() || 'other';
        const state = await loadState();

        console.log(chalk.cyan('\nLet\'s update your preferences...\n'));
        console.log(chalk.gray(`  Current name:   ${currentName}`));
        console.log(chalk.gray(`  Current gender: ${currentGender}\n`));

        const { userName, gender } = await inquirer.prompt([
            {
                type: 'input',
                name: 'userName',
                message: 'What should you be called?',
                default: currentName,
            },
            {
                type: 'list',
                name: 'gender',
                message: 'How should you be addressed?',
                default: currentGender,
                choices: [
                    { name: 'Male', value: 'male' },
                    { name: 'Female', value: 'female' },
                    { name: 'Other', value: 'other' },
                ],
            },
        ]);

        state.userName = userName;
        state.gender = gender as 'male' | 'female' | 'other';
        await saveState(state);
        await ensureSelfPerson(userName, gender);

        await refreshResponseCache();

        console.log(chalk.green('\n✓ Preferences updated!'));
        console.log(chalk.cyan(getResponse('greeting')));
    });

export default setupCommand;
