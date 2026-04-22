// ─────────────────────────────────────────────────────────────────────────────
// Feral Slack — Catalog Source
// ─────────────────────────────────────────────────────────────────────────────
import { createCatalogNode } from './catalog-node.js';
/**
 * Provides pre-configured CatalogNodes for the Slack module.
 * Each builder function gets its own CatalogNode.
 */
export class SlackCatalogSource {
    getCatalogNodes() {
        return [
            // Block Builder function variants
            createCatalogNode({
                key: 'slack_block_init',
                nodeCodeKey: 'slack_section_block_builder',
                name: 'Slack Block Init',
                group: 'slack',
                description: 'Initialize a new Slack section block',
                configuration: { function: 'init' },
            }),
            createCatalogNode({
                key: 'slack_block_add_button',
                nodeCodeKey: 'slack_section_block_builder',
                name: 'Slack Block Add Button',
                group: 'slack',
                description: 'Add a button element to the current block',
                configuration: { function: 'add-button' },
            }),
            createCatalogNode({
                key: 'slack_block_add_text',
                nodeCodeKey: 'slack_section_block_builder',
                name: 'Slack Block Add Text',
                group: 'slack',
                description: 'Add text to the current block',
                configuration: { function: 'add-text' },
            }),
            createCatalogNode({
                key: 'slack_block_add_checkbox',
                nodeCodeKey: 'slack_section_block_builder',
                name: 'Slack Block Add Checkbox',
                group: 'slack',
                description: 'Add a checkbox group to the current block',
                configuration: { function: 'add-checkbox' },
            }),
            createCatalogNode({
                key: 'slack_block_add_image',
                nodeCodeKey: 'slack_section_block_builder',
                name: 'Slack Block Add Image',
                group: 'slack',
                description: 'Add an image element to the current block',
                configuration: { function: 'add-image' },
            }),
            createCatalogNode({
                key: 'slack_block_add_datepicker',
                nodeCodeKey: 'slack_section_block_builder',
                name: 'Slack Block Add Date Picker',
                group: 'slack',
                description: 'Add a date picker element to the current block',
                configuration: { function: 'add-datepicker' },
            }),
            createCatalogNode({
                key: 'slack_block_add_text_input',
                nodeCodeKey: 'slack_section_block_builder',
                name: 'Slack Block Add Text Input',
                group: 'slack',
                description: 'Add a plain text input element to the current block',
                configuration: { function: 'add-input' },
            }),
            createCatalogNode({
                key: 'slack_block_build',
                nodeCodeKey: 'slack_section_block_builder',
                name: 'Slack Block Build',
                group: 'slack',
                description: 'Finalize and build the current block',
                configuration: { function: 'build' },
            }),
            // Webhook poster
            createCatalogNode({
                key: 'slack_post_webhook',
                nodeCodeKey: 'slack_post_webhook',
                name: 'Slack Post Webhook',
                group: 'slack',
                description: 'Post a message to a Slack webhook URL',
            }),
            // Slash command processor
            createCatalogNode({
                key: 'process_slash_command',
                nodeCodeKey: 'process_slash_command',
                name: 'Process Slash Command',
                group: 'slack',
                description: 'Parse a Slack slash command POST body',
            }),
        ];
    }
}
