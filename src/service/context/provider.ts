import type { Task, TaskContext, EntityType } from '../protocol.js';
import { getSubdirectoryContext, getVaultContext, buildContextChain } from '../../context/reader.js';
import { getVaultRoot } from '../../state/manager.js';

/**
 * Full context containing all available context information.
 */
export interface FullContext {
    globalContext: string;
    projectContext: string;
    entityContext: string;
    symbols: ReadonlyMap<string, string>;
    taskTokens: Readonly<Record<string, string>>;
    combined: string;
}

/**
 * Context provider for unified access to different context levels.
 */
export class ContextProvider {
    private cache: Map<string, { content: string; loadedAt: Date }> = new Map();
    private symbols: Map<string, string> = new Map();
    private cacheMaxAgeMs = 60000; // 1 minute cache

    constructor(
        private vaultRoot: string,
        private taskContext: TaskContext
    ) {
        this.initializeDefaultSymbols();
    }

    /**
     * Create a context provider from the current environment.
     */
    static async create(taskContext: TaskContext): Promise<ContextProvider> {
        const vaultRoot = await getVaultRoot();
        return new ContextProvider(vaultRoot, taskContext);
    }

    /**
     * Initialize default symbols.
     */
    private initializeDefaultSymbols(): void {
        const now = new Date();
        this.symbols.set('current_date', now.toISOString().split('T')[0]);
        this.symbols.set('current_time', now.toISOString());
        this.symbols.set('vault_path', this.vaultRoot);
    }

    /**
     * Get the global symbol table.
     */
    getGlobalSymbols(): ReadonlyMap<string, string> {
        return this.symbols;
    }

    /**
     * Get a single symbol value.
     */
    getSymbol(key: string): string | undefined {
        return this.symbols.get(key) ?? this.taskContext.tokens[key];
    }

    /**
     * Get the current task context.
     */
    getTaskContext(): TaskContext {
        return this.taskContext;
    }

    /**
     * Get tokens from the task context.
     */
    getTaskTokens(): Readonly<Record<string, string>> {
        return this.taskContext.tokens;
    }

    /**
     * Get global context from vault root.
     */
    async getGlobalContext(): Promise<string> {
        return this.getCachedContext('global', async () => {
            const contexts = await buildContextChain(this.vaultRoot);
            return contexts.reverse().join('\n\n---\n\n');
        });
    }

    /**
     * Get vault context from vault root .vault.md.
     */
    async getVaultContext(): Promise<string> {
        return this.getCachedContext('vault', async () => {
            return getVaultContext();
        });
    }

    /**
     * Get context for a specific entity type.
     */
    async getEntityContext(entity: EntityType): Promise<string> {
        return this.getCachedContext(`entity:${entity}`, async () => {
            return getSubdirectoryContext(entity);
        });
    }

    /**
     * Get the full context chain from root to entity.
     */
    async getEntityContextChain(entity: EntityType): Promise<string> {
        return this.getCachedContext(`entity-chain:${entity}`, async () => {
            return getSubdirectoryContext(entity);
        });
    }

    /**
     * Get all relevant context for a task.
     */
    async getFullContext(entity: EntityType): Promise<FullContext> {
        const [globalContext, vaultContext, entityContext] = await Promise.all([
            this.getGlobalContext(),
            this.getVaultContext(),
            this.getEntityContext(entity),
        ]);

        const combined = [globalContext, vaultContext, entityContext]
            .filter(Boolean)
            .join('\n\n---\n\n');

        return {
            globalContext,
            projectContext: vaultContext,
            entityContext,
            symbols: this.symbols,
            taskTokens: this.taskContext.tokens,
            combined,
        };
    }

    /**
     * Invalidate cache for a specific path or all cache.
     */
    invalidateCache(path?: string): void {
        if (path) {
            // Invalidate entries containing this path
            for (const key of this.cache.keys()) {
                if (key.includes(path)) {
                    this.cache.delete(key);
                }
            }
        } else {
            this.cache.clear();
        }
    }

    /**
     * Get cached context or load it.
     */
    private async getCachedContext(
        key: string,
        loader: () => Promise<string>
    ): Promise<string> {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.loadedAt.getTime() < this.cacheMaxAgeMs) {
            return cached.content;
        }

        const content = await loader();
        this.cache.set(key, { content, loadedAt: new Date() });
        return content;
    }
}
