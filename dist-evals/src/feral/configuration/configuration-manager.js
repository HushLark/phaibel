// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Configuration Manager
// ─────────────────────────────────────────────────────────────────────────────
export class ConfigurationManager {
    static DELETE = '_DELETE_';
    config = new Map();
    merge(overrides) {
        for (const cv of overrides) {
            if (this.config.has(cv.key) && cv.value === ConfigurationManager.DELETE) {
                this.config.delete(cv.key);
            }
            else {
                this.config.set(cv.key, cv);
            }
        }
    }
    hasValue(key) {
        const cv = this.config.get(key);
        return cv != null && cv.value != null;
    }
    hasDefault(key) {
        const cv = this.config.get(key);
        return cv != null && cv.default != null;
    }
    getValue(key) {
        const cv = this.config.get(key);
        if (!cv)
            return null;
        if (cv.value != null)
            return cv.value;
        return cv.default ?? null;
    }
    getUnmaskedValue(key) {
        const cv = this.config.get(key);
        return cv?.value ?? cv?.default ?? null;
    }
    getAll() {
        return new Map(this.config);
    }
}
