// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Context Value Comparator NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
export class ComparatorNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'left_context_path', name: 'Left Value Path', description: 'Context key for the left operand.', type: 'string' },
        { key: 'right_context_path', name: 'Right Value Path', description: 'Context key for the right operand.', type: 'string', isOptional: true },
        { key: 'right_value', name: 'Right Value', description: 'Literal value for the right operand (used if right_context_path is not set).', type: 'string', isOptional: true },
    ];
    static resultDescriptions = [
        { status: ResultStatus.TRUE, description: 'Values are equal.' },
        { status: ResultStatus.FALSE, description: 'Values are not equal.' },
        { status: ResultStatus.GREATER_THAN, description: 'Left > right.' },
        { status: ResultStatus.GREATER_THAN_EQUAL, description: 'Left >= right.' },
        { status: ResultStatus.LESS_THAN, description: 'Left < right.' },
        { status: ResultStatus.LESS_THAN_EQUAL, description: 'Left <= right.' },
    ];
    constructor() {
        super('context_value_comparator', 'Compare Values', 'Compares two context values, returns comparison result.', NodeCodeCategory.FLOW);
    }
    async process(context) {
        const leftPath = this.getRequiredConfigValue('left_context_path');
        const left = context.get(leftPath);
        // Get right value: from context path or literal
        let right;
        const rightPath = this.getOptionalConfigValue('right_context_path');
        if (rightPath) {
            right = context.get(rightPath);
        }
        else {
            right = this.getOptionalConfigValue('right_value');
        }
        // Numeric comparison when both sides are numbers
        const leftNum = Number(left);
        const rightNum = Number(right);
        if (!isNaN(leftNum) && !isNaN(rightNum)) {
            if (leftNum === rightNum)
                return this.result(ResultStatus.TRUE, `${leftNum} == ${rightNum}`);
            if (leftNum > rightNum)
                return this.result(ResultStatus.GREATER_THAN, `${leftNum} > ${rightNum}`);
            return this.result(ResultStatus.LESS_THAN, `${leftNum} < ${rightNum}`);
        }
        // String / strict equality comparison
        const leftStr = String(left ?? '');
        const rightStr = String(right ?? '');
        if (leftStr === rightStr) {
            return this.result(ResultStatus.TRUE, `"${leftStr}" == "${rightStr}"`);
        }
        return this.result(ResultStatus.FALSE, `"${leftStr}" != "${rightStr}"`);
    }
}
