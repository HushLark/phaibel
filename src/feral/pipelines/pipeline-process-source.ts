// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Process Source
// ─────────────────────────────────────────────────────────────────────────────
//
// Registers named pipeline processes with the Feral process factory.
// Add new pipeline variants here as they are built.
// ─────────────────────────────────────────────────────────────────────────────

import type { Process } from '../process/process.js';
import type { ProcessSource } from '../process/process-factory.js';
import { STANDARD_PIPELINE } from './standard-pipeline.js';
import { CRUEL_SUMMER_PIPELINE } from './cruel-summer-pipeline.js';
import { HERTZ_PIPELINE } from './hertz-pipeline.js';
import { TAKE_ON_ME_PIPELINE } from './take-on-me-pipeline.js';

export class PipelineProcessSource implements ProcessSource {
    private readonly pipelines: Process[] = [
        STANDARD_PIPELINE,
        CRUEL_SUMMER_PIPELINE,
        HERTZ_PIPELINE,
        TAKE_ON_ME_PIPELINE,
    ];

    getProcesses(): Process[] {
        return this.pipelines;
    }

    /** Names of all registered pipelines (for config validation). */
    getPipelineKeys(): string[] {
        return this.pipelines.map(p => p.key);
    }
}

/** Singleton shared between bootstrap and chat.ts */
export const pipelineProcessSource = new PipelineProcessSource();
