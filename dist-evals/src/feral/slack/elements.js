// ─────────────────────────────────────────────────────────────────────────────
// Feral Slack — Element Data Objects
// ─────────────────────────────────────────────────────────────────────────────
import { BlockType, ElementType } from './types.js';
/**
 * Button element.
 */
export class Button {
    type = ElementType.BUTTON;
    actionId;
    text;
    url;
    value;
    style;
    confirm;
    constructor(actionId, text) {
        this.actionId = actionId;
        this.text = text;
    }
    getValidBlocks() {
        return [BlockType.ACTIONS, BlockType.SECTION];
    }
    toJSON() {
        const json = {
            type: this.type,
            action_id: this.actionId,
            text: this.text.toJSON(),
        };
        if (this.url)
            json.url = this.url;
        if (this.value)
            json.value = this.value;
        if (this.style)
            json.style = this.style;
        if (this.confirm)
            json.confirm = this.confirm.toJSON();
        return json;
    }
}
/**
 * Checkbox group element.
 */
export class Checkbox {
    type = ElementType.CHECKBOX;
    actionId;
    options = [];
    initialOptions;
    confirm;
    constructor(actionId) {
        this.actionId = actionId;
    }
    getValidBlocks() {
        return [BlockType.ACTIONS, BlockType.SECTION];
    }
    toJSON() {
        const json = {
            type: this.type,
            action_id: this.actionId,
            options: this.options.map(o => o.toJSON()),
        };
        if (this.initialOptions)
            json.initial_options = this.initialOptions.map(o => o.toJSON());
        if (this.confirm)
            json.confirm = this.confirm.toJSON();
        return json;
    }
}
/**
 * Date picker element.
 */
export class DatePicker {
    type = ElementType.DATE_PICKER;
    actionId;
    placeholder;
    initialDate; // YYYY-MM-DD
    confirm;
    constructor(actionId) {
        this.actionId = actionId;
    }
    getValidBlocks() {
        return [BlockType.ACTIONS, BlockType.SECTION, BlockType.INPUT];
    }
    toJSON() {
        const json = {
            type: this.type,
            action_id: this.actionId,
        };
        if (this.placeholder)
            json.placeholder = this.placeholder.toJSON();
        if (this.initialDate)
            json.initial_date = this.initialDate;
        if (this.confirm)
            json.confirm = this.confirm.toJSON();
        return json;
    }
}
/**
 * Image element (not a block — used within Section/Context).
 */
export class ImageElement {
    type = ElementType.IMAGE;
    imageUrl;
    altText;
    constructor(imageUrl, altText) {
        this.imageUrl = imageUrl;
        this.altText = altText;
    }
    getValidBlocks() {
        return [BlockType.SECTION, BlockType.CONTEXT];
    }
    toJSON() {
        return {
            type: this.type,
            image_url: this.imageUrl,
            alt_text: this.altText,
        };
    }
}
/**
 * Plain text input element.
 */
export class PlainTextInput {
    type = ElementType.PLAIN_TEXT_INPUT;
    actionId;
    placeholder;
    initialValue;
    multiline = false;
    minLength;
    maxLength;
    constructor(actionId) {
        this.actionId = actionId;
    }
    getValidBlocks() {
        return [BlockType.INPUT, BlockType.SECTION, BlockType.ACTIONS];
    }
    toJSON() {
        const json = {
            type: this.type,
            action_id: this.actionId,
        };
        if (this.placeholder)
            json.placeholder = this.placeholder.toJSON();
        if (this.initialValue)
            json.initial_value = this.initialValue;
        if (this.multiline)
            json.multiline = this.multiline;
        if (this.minLength !== undefined)
            json.min_length = this.minLength;
        if (this.maxLength !== undefined)
            json.max_length = this.maxLength;
        return json;
    }
}
/**
 * Multi-select menu element.
 */
export class MultiSelect {
    type = ElementType.MULTI_SELECT;
    actionId;
    options = [];
    initialOptions;
    placeholder;
    confirm;
    constructor(actionId) {
        this.actionId = actionId;
    }
    getValidBlocks() {
        return [BlockType.SECTION, BlockType.ACTIONS, BlockType.INPUT];
    }
    toJSON() {
        const json = {
            type: this.type,
            action_id: this.actionId,
            options: this.options.map(o => o.toJSON()),
        };
        if (this.initialOptions)
            json.initial_options = this.initialOptions.map(o => o.toJSON());
        if (this.placeholder)
            json.placeholder = this.placeholder.toJSON();
        if (this.confirm)
            json.confirm = this.confirm.toJSON();
        return json;
    }
}
/**
 * Overflow menu element.
 */
export class Overflow {
    type = ElementType.OVERFLOW;
    actionId;
    options = [];
    confirm;
    constructor(actionId) {
        this.actionId = actionId;
    }
    getValidBlocks() {
        return [BlockType.ACTIONS, BlockType.SECTION];
    }
    toJSON() {
        const json = {
            type: this.type,
            action_id: this.actionId,
            options: this.options.map(o => o.toJSON()),
        };
        if (this.confirm)
            json.confirm = this.confirm.toJSON();
        return json;
    }
}
/**
 * Radio button group element.
 */
export class RadioButton {
    type = ElementType.RADIO_BUTTON;
    actionId;
    options = [];
    initialOption;
    confirm;
    constructor(actionId) {
        this.actionId = actionId;
    }
    getValidBlocks() {
        return [BlockType.ACTIONS, BlockType.SECTION, BlockType.INPUT];
    }
    toJSON() {
        const json = {
            type: this.type,
            action_id: this.actionId,
            options: this.options.map(o => o.toJSON()),
        };
        if (this.initialOption)
            json.initial_option = this.initialOption.toJSON();
        if (this.confirm)
            json.confirm = this.confirm.toJSON();
        return json;
    }
}
/**
 * Select menu element.
 */
export class Select {
    type = ElementType.SELECT;
    actionId;
    options = [];
    initialOption;
    placeholder;
    confirm;
    constructor(actionId) {
        this.actionId = actionId;
    }
    getValidBlocks() {
        return [BlockType.ACTIONS, BlockType.SECTION, BlockType.INPUT];
    }
    toJSON() {
        const json = {
            type: this.type,
            action_id: this.actionId,
            options: this.options.map(o => o.toJSON()),
        };
        if (this.initialOption)
            json.initial_option = this.initialOption.toJSON();
        if (this.placeholder)
            json.placeholder = this.placeholder.toJSON();
        if (this.confirm)
            json.confirm = this.confirm.toJSON();
        return json;
    }
}
