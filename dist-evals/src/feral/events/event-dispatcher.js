// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Event Dispatcher
// ─────────────────────────────────────────────────────────────────────────────
export class EventDispatcher {
    handlers = new Map();
    on(type, handler) {
        if (!this.handlers.has(type))
            this.handlers.set(type, []);
        this.handlers.get(type).push(handler);
    }
    off(type, handler) {
        const list = this.handlers.get(type);
        if (list) {
            const idx = list.indexOf(handler);
            if (idx >= 0)
                list.splice(idx, 1);
        }
    }
    dispatch(event) {
        const list = this.handlers.get(event.type);
        if (list) {
            for (const handler of list)
                handler(event);
        }
    }
}
