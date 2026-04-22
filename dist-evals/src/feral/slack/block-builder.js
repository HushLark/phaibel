// ─────────────────────────────────────────────────────────────────────────────
// Feral Slack — Block Builder
// ─────────────────────────────────────────────────────────────────────────────
import { BlockType, Surface, TextType } from './types.js';
import { Text, Option } from './composition.js';
import { Section, Actions, ContextBlock, Divider, ImageBlock, InputBlock } from './blocks.js';
import { Button, Checkbox, DatePicker, ImageElement, PlainTextInput } from './elements.js';
import { MappingFactory } from './mapping-factory.js';
/**
 * Fluent builder for constructing Slack Block Kit structures.
 * Delegates to MappingFactory for block/element instantiation.
 */
export class BlockBuilder {
    blockFactory;
    currentBlock;
    currentSurface;
    constructor(blockFactory) {
        this.blockFactory = blockFactory ?? createDefaultBlockFactory();
    }
    /**
     * Initialize with a Section block for the given surface.
     */
    initAsSectionForSurface(surface = Surface.MESSAGE) {
        const section = new Section();
        this.validateSurfaceForBlock(section, surface);
        this.currentBlock = section;
        this.currentSurface = surface;
        return this;
    }
    /**
     * Initialize with a block of the given type for the given surface.
     */
    initWithTypeForSurface(type, surface = Surface.MESSAGE) {
        const block = this.blockFactory.build(type);
        this.validateSurfaceForBlock(block, surface);
        this.currentBlock = block;
        this.currentSurface = surface;
        return this;
    }
    /**
     * Initialize with a pre-made block for the given surface.
     */
    initWithBlockForSurface(block, surface = Surface.MESSAGE) {
        this.validateSurfaceForBlock(block, surface);
        this.currentBlock = block;
        this.currentSurface = surface;
        return this;
    }
    /**
     * Add text to the current block (Section text or Context element).
     */
    addText(label, type = TextType.MRKDWN, emoji, verbatim) {
        this.ensureBlock();
        const text = new Text(label, type);
        if (emoji !== undefined)
            text.emoji = emoji;
        if (verbatim !== undefined)
            text.verbatim = verbatim;
        const block = this.currentBlock;
        if (block instanceof Section) {
            block.text = text;
        }
        else if (block instanceof ContextBlock) {
            block.addElement(text);
        }
        return this;
    }
    /**
     * Add a button element.
     */
    addButton(actionId, label, url, value, style) {
        this.ensureBlock();
        const text = new Text(label, TextType.PLAIN_TEXT);
        const button = new Button(actionId, text);
        if (url)
            button.url = url;
        if (value)
            button.value = value;
        if (style)
            button.style = style;
        this.validateElementForBlock(button);
        this.addElementToBlock(button);
        return this;
    }
    /**
     * Add a checkbox group element.
     */
    addCheckbox(actionId, choices, chosen) {
        this.ensureBlock();
        const checkbox = new Checkbox(actionId);
        for (const [key, label] of Object.entries(choices)) {
            const option = new Option(new Text(label, TextType.PLAIN_TEXT), key);
            checkbox.options.push(option);
        }
        if (chosen) {
            checkbox.initialOptions = checkbox.options.filter(o => chosen.includes(o.value));
        }
        this.validateElementForBlock(checkbox);
        this.addElementToBlock(checkbox);
        return this;
    }
    /**
     * Add an image element.
     */
    addImage(imageUrl, altText = '') {
        this.ensureBlock();
        const image = new ImageElement(imageUrl, altText);
        this.validateElementForBlock(image);
        this.addElementToBlock(image);
        return this;
    }
    /**
     * Add a date picker element.
     */
    addDatePicker(actionId, text, date) {
        this.ensureBlock();
        const picker = new DatePicker(actionId);
        if (text)
            picker.placeholder = new Text(text, TextType.PLAIN_TEXT);
        if (date)
            picker.initialDate = date;
        this.validateElementForBlock(picker);
        this.addElementToBlock(picker);
        return this;
    }
    /**
     * Add a plain text input element.
     */
    addPlainTextInput(actionId, text, value, multiline, minLength, maxLength) {
        this.ensureBlock();
        const input = new PlainTextInput(actionId);
        if (text)
            input.placeholder = new Text(text, TextType.PLAIN_TEXT);
        if (value)
            input.initialValue = value;
        if (multiline !== undefined)
            input.multiline = multiline;
        if (minLength !== undefined)
            input.minLength = minLength;
        if (maxLength !== undefined)
            input.maxLength = maxLength;
        this.validateElementForBlock(input);
        this.addElementToBlock(input);
        return this;
    }
    /**
     * Finalize and return the built block.
     */
    build() {
        this.ensureBlock();
        const block = this.currentBlock;
        this.currentBlock = undefined;
        this.currentSurface = undefined;
        return block;
    }
    // ─── Private helpers ─────────────────────────────────────────────────────
    ensureBlock() {
        if (!this.currentBlock) {
            throw new Error('BlockBuilder: no block initialized. Call init* first.');
        }
    }
    validateSurfaceForBlock(block, surface) {
        const validSurfaces = block.getValidSurfaces();
        if (!validSurfaces.includes(surface)) {
            throw new Error(`Block type "${block.type}" is not valid for surface "${surface}". ` +
                `Valid surfaces: ${validSurfaces.join(', ')}`);
        }
    }
    validateElementForBlock(element) {
        const block = this.currentBlock;
        const validBlocks = element.getValidBlocks();
        if (!validBlocks.includes(block.type)) {
            throw new Error(`Element type "${element.type}" is not valid for block type "${block.type}". ` +
                `Valid blocks: ${validBlocks.join(', ')}`);
        }
    }
    addElementToBlock(element) {
        const block = this.currentBlock;
        if (block instanceof Section) {
            block.accessory = element;
        }
        else if (block instanceof Actions) {
            block.addElement(element);
        }
        else if (block instanceof ContextBlock) {
            block.addElement(element);
        }
        else if (block instanceof InputBlock) {
            block.element = element;
        }
    }
}
/**
 * Creates the default block factory with all standard block types.
 */
export function createDefaultBlockFactory() {
    return new MappingFactory({
        [BlockType.SECTION]: Section,
        [BlockType.ACTIONS]: Actions,
        [BlockType.CONTEXT]: ContextBlock,
        [BlockType.DIVIDER]: Divider,
        [BlockType.IMAGE]: ImageBlock,
        [BlockType.INPUT]: InputBlock,
    });
}
