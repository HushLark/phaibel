import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockExecutionContext, createMockLLM } from '../helpers.js';

vi.mock('../../src/state/manager.js', () => ({
    getActiveProject: vi.fn().mockResolvedValue('test-project'),
    getVaultRoot: vi.fn().mockResolvedValue('/tmp/test-vault'),
    setActiveProject: vi.fn(),
    listProjects: vi.fn().mockResolvedValue(['test-project']),
    createProject: vi.fn(),
    projectExists: vi.fn().mockResolvedValue(false),
}));

vi.mock('fs', async () => {
    const actual = await vi.importActual<typeof import('fs')>('fs');
    return {
        ...actual,
        promises: {
            ...actual.promises,
            readdir: vi.fn().mockResolvedValue([]),
            readFile: vi.fn().mockResolvedValue('---\ntitle: Test\n---\nContent'),
            writeFile: vi.fn().mockResolvedValue(undefined),
            mkdir: vi.fn().mockResolvedValue(undefined),
            stat: vi.fn().mockRejectedValue(new Error('ENOENT')),
        },
    };
});

vi.mock('gray-matter', () => ({
    default: vi.fn().mockReturnValue({ data: {}, content: '' }),
}));

import '../../src/tools/daily.js';
import { getServiceTool } from '../../src/tools/types.js';

describe('daily tools', () => {
    beforeEach(() => vi.clearAllMocks());

    describe('daily.today', () => {
        it('should be registered', () => {
            expect(getServiceTool('daily.today')).toBeDefined();
        });

        it('should be an AI tool', () => {
            const tool = getServiceTool('daily.today')!;
            expect(tool.type).toBe('ai');
        });

});

    describe('daily.tomorrow', () => {
        it('should be registered', () => {
            expect(getServiceTool('daily.tomorrow')).toBeDefined();
        });

        it('should be an AI tool', () => {
            const tool = getServiceTool('daily.tomorrow')!;
            expect(tool.type).toBe('ai');
        });
    });

    describe('daily.get', () => {
        it('should be registered', () => {
            expect(getServiceTool('daily.get')).toBeDefined();
        });

        it('should be a deterministic tool', () => {
            const tool = getServiceTool('daily.get')!;
            expect(tool.type).toBe('deterministic');
        });

        it('should require a date input', () => {
            const tool = getServiceTool('daily.get')!;
            expect(tool.inputSchema?.required).toContain('date');
        });
    });
});
