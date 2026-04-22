import { getSubdirectoryContext, getVaultContext, buildContextChain } from '../../context/reader.js';
import { getVaultRoot } from '../../state/manager.js';
/**
 * Context provider for unified access to different context levels.
 */
export class ContextProvider {
    vaultRoot;
    taskContext;
    cache = new Map();
    symbols = new Map();
    cacheMaxAgeMs = 60000; // 1 minute cache
    constructor(vaultRoot, taskContext) {
        this.vaultRoot = vaultRoot;
        this.taskContext = taskContext;
        this.initializeDefaultSymbols();
    }
    /**
     * Create a context provider from the current environment.
     */
    static async create(taskContext) {
        const vaultRoot = await getVaultRoot();
        return new ContextProvider(vaultRoot, taskContext);
    }
    /**
     * Initialize default symbols.
     */
    initializeDefaultSymbols() {
        const now = new Date();
        this.symbols.set('current_date', now.toISOString().split('T')[0]);
        this.symbols.set('current_time', now.toISOString());
        this.symbols.set('vault_path', this.vaultRoot);
    }
    /**
     * Get the global symbol table.
     */
    getGlobalSymbols() {
        return this.symbols;
    }
    /**
     * Get a single symbol value.
     */
    getSymbol(key) {
        return this.symbols.get(key) ?? this.taskContext.tokens[key];
    }
    /**
     * Get the current task context.
     */
    getTaskContext() {
        return this.taskContext;
    }
    /**
     * Get tokens from the task context.
     */
    getTaskTokens() {
        return this.taskContext.tokens;
    }
    /**
     * Get global context from vault root.
     */
    async getGlobalContext() {
        return this.getCachedContext('global', async () => {
            const contexts = await buildContextChain(this.vaultRoot);
            return contexts.reverse().join('\n\n---\n\n');
        });
    }
    /**
     * Get vault context from vault root .vault.md.
     */
    async getVaultContext() {
        return this.getCachedContext('vault', async () => {
            return getVaultContext();
        });
    }
    /**
     * Get context for a specific entity type.
     */
    async getEntityContext(entity) {
        return this.getCachedContext(`entity:${entity}`, async () => {
            return getSubdirectoryContext(entity);
        });
    }
    /**
     * Get the full context chain from root to entity.
     */
    async getEntityContextChain(entity) {
        return this.getCachedContext(`entity-chain:${entity}`, async () => {
            return getSubdirectoryContext(entity);
        });
    }
    /**
     * Get all relevant context for a task.
     */
    async getFullContext(entity) {
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
    invalidateCache(path) {
        if (path) {
            // Invalidate entries containing this path
            for (const key of this.cache.keys()) {
                if (key.includes(path)) {
                    this.cache.delete(key);
                }
            }
        }
        else {
            this.cache.clear();
        }
    }
    /**
     * Get cached context or load it.
     */
    async getCachedContext(key, loader) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.loadedAt.getTime() < this.cacheMaxAgeMs) {
            return cached.content;
        }
        const content = await loader();
        this.cache.set(key, { content, loadedAt: new Date() });
        return content;
    }
}
