// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Context
// ─────────────────────────────────────────────────────────────────────────────
export class DefaultContext {
    data = {};
    set(key, value) {
        this.data[key] = value;
    }
    get(key) {
        return this.data[key] ?? null;
    }
    has(key) {
        return key in this.data && this.data[key] != null;
    }
    remove(key) {
        this.data[key] = null;
    }
    clear(key) {
        if (this.has(key)) {
            this.data[key] = null;
            return true;
        }
        return false;
    }
    getAll() {
        return { ...this.data };
    }
    getInt(key) {
        return Number(this.data[key]) | 0;
    }
    getFloat(key) {
        return Number(this.data[key]);
    }
    getString(key) {
        return String(this.data[key] ?? '');
    }
    getArray(key) {
        return Array.isArray(this.data[key]) ? this.data[key] : [];
    }
    getObject(key) {
        return this.data[key];
    }
}
