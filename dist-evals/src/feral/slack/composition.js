// ─────────────────────────────────────────────────────────────────────────────
// Feral Slack — Composition Objects
// ─────────────────────────────────────────────────────────────────────────────
import { TextType } from './types.js';
/**
 * Text composition object (plain_text or mrkdwn).
 */
export class Text {
    type;
    text;
    emoji;
    verbatim;
    constructor(text, type = TextType.PLAIN_TEXT) {
        this.type = type;
        this.text = text;
    }
    toJSON() {
        const json = { type: this.type, text: this.text };
        if (this.emoji !== undefined)
            json.emoji = this.emoji;
        if (this.verbatim !== undefined)
            json.verbatim = this.verbatim;
        return json;
    }
}
/**
 * Option composition object.
 */
export class Option {
    text;
    value;
    description;
    url;
    constructor(text, value) {
        this.text = text;
        this.value = value;
    }
    toJSON() {
        const json = {
            text: this.text.toJSON(),
            value: this.value,
        };
        if (this.description)
            json.description = this.description.toJSON();
        if (this.url)
            json.url = this.url;
        return json;
    }
}
/**
 * Option group composition object.
 */
export class OptionGroup {
    label;
    options;
    constructor(label, options = []) {
        this.label = label;
        this.options = options;
    }
    toJSON() {
        return {
            label: this.label.toJSON(),
            options: this.options.map(o => o.toJSON()),
        };
    }
}
/**
 * Confirmation dialog composition object.
 */
export class Confirmation {
    title;
    text;
    confirm;
    deny;
    style;
    constructor(title, text, confirm, deny) {
        this.title = title;
        this.text = text;
        this.confirm = confirm;
        this.deny = deny;
    }
    toJSON() {
        const json = {
            title: this.title.toJSON(),
            text: this.text.toJSON(),
            confirm: this.confirm.toJSON(),
            deny: this.deny.toJSON(),
        };
        if (this.style)
            json.style = this.style;
        return json;
    }
}
/**
 * Filter composition object.
 */
export class Filter {
    include;
    excludeExternalSharedChannels;
    excludeBotUsers;
    toJSON() {
        const json = {};
        if (this.include)
            json.include = this.include;
        if (this.excludeExternalSharedChannels !== undefined) {
            json.exclude_external_shared_channels = this.excludeExternalSharedChannels;
        }
        if (this.excludeBotUsers !== undefined) {
            json.exclude_bot_users = this.excludeBotUsers;
        }
        return json;
    }
}
