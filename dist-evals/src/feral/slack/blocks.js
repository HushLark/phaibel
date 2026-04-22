// ─────────────────────────────────────────────────────────────────────────────
// Feral Slack — Block Data Objects
// ─────────────────────────────────────────────────────────────────────────────
import { BlockType, Surface } from './types.js';
/**
 * Section block — the most versatile block type.
 */
export class Section {
    type = BlockType.SECTION;
    blockId;
    text;
    fields;
    accessory;
    getValidSurfaces() {
        return [Surface.MESSAGE, Surface.MODAL, Surface.HOME_TAB];
    }
    toJSON() {
        const json = { type: this.type };
        if (this.blockId)
            json.block_id = this.blockId;
        if (this.text)
            json.text = this.text.toJSON();
        if (this.fields)
            json.fields = this.fields.map(f => f.toJSON());
        if (this.accessory)
            json.accessory = this.accessory.toJSON();
        return json;
    }
}
/**
 * Actions block — holds interactive elements.
 */
export class Actions {
    type = BlockType.ACTIONS;
    blockId;
    elements = [];
    getValidSurfaces() {
        return [Surface.MESSAGE, Surface.MODAL, Surface.HOME_TAB];
    }
    addElement(element) {
        this.elements.push(element);
    }
    toJSON() {
        const json = {
            type: this.type,
            elements: this.elements.map(e => e.toJSON()),
        };
        if (this.blockId)
            json.block_id = this.blockId;
        return json;
    }
}
/**
 * Context block — displays contextual info.
 */
export class ContextBlock {
    type = BlockType.CONTEXT;
    blockId;
    elements = [];
    getValidSurfaces() {
        return [Surface.MESSAGE, Surface.MODAL, Surface.HOME_TAB];
    }
    addElement(element) {
        this.elements.push(element);
    }
    toJSON() {
        const json = {
            type: this.type,
            elements: this.elements.map(e => e.toJSON()),
        };
        if (this.blockId)
            json.block_id = this.blockId;
        return json;
    }
}
/**
 * Divider block — a visual separator.
 */
export class Divider {
    type = BlockType.DIVIDER;
    blockId;
    getValidSurfaces() {
        return [Surface.MESSAGE, Surface.MODAL, Surface.HOME_TAB];
    }
    toJSON() {
        const json = { type: this.type };
        if (this.blockId)
            json.block_id = this.blockId;
        return json;
    }
}
/**
 * File block — for displaying remote files.
 */
export class FileBlock {
    type = BlockType.FILE;
    blockId;
    externalId;
    source = 'remote';
    constructor(externalId) {
        this.externalId = externalId;
    }
    getValidSurfaces() {
        return [Surface.MESSAGE];
    }
    toJSON() {
        const json = {
            type: this.type,
            external_id: this.externalId,
            source: this.source,
        };
        if (this.blockId)
            json.block_id = this.blockId;
        return json;
    }
}
/**
 * Image block — for displaying images.
 */
export class ImageBlock {
    type = BlockType.IMAGE;
    blockId;
    imageUrl;
    altText;
    title;
    constructor(imageUrl, altText) {
        this.imageUrl = imageUrl;
        this.altText = altText;
    }
    getValidSurfaces() {
        return [Surface.MESSAGE, Surface.MODAL, Surface.HOME_TAB];
    }
    toJSON() {
        const json = {
            type: this.type,
            image_url: this.imageUrl,
            alt_text: this.altText,
        };
        if (this.blockId)
            json.block_id = this.blockId;
        if (this.title)
            json.title = this.title.toJSON();
        return json;
    }
}
/**
 * Input block — collects user input (modal only).
 */
export class InputBlock {
    type = BlockType.INPUT;
    blockId;
    label;
    element;
    hint;
    optional = false;
    dispatchAction = false;
    constructor(label) {
        this.label = label;
    }
    getValidSurfaces() {
        return [Surface.MODAL];
    }
    toJSON() {
        const json = {
            type: this.type,
            label: this.label.toJSON(),
        };
        if (this.blockId)
            json.block_id = this.blockId;
        if (this.element)
            json.element = this.element.toJSON();
        if (this.hint)
            json.hint = this.hint.toJSON();
        if (this.optional)
            json.optional = this.optional;
        if (this.dispatchAction)
            json.dispatch_action = this.dispatchAction;
        return json;
    }
}
