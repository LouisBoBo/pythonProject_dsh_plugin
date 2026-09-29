import { useEffect } from 'react';
/** Keep host-version differences at the navigation boundary, not in pages. */
export function registerMainPanel(ctx, id, priority, render, onHidden = () => { }) {
    const layout = ctx.layout;
    if (typeof layout.selectPanel !== 'function') {
        return ctx.slots.register({ name: 'conversation', priority }, render);
    }
    // 0.1.5 moves global panels from the session-scoped conversation seat to
    // root-scoped keyed main entries. This cast is confined to the version bridge.
    const slots = ctx.slots;
    let disposed = false;
    let generation = 0;
    const Body = (props) => {
        useEffect(() => {
            const current = ++generation;
            return () => {
                // Ignore StrictMode's effect replay and our own explicit removal.
                queueMicrotask(() => { if (!disposed && generation === current)
                    onHidden(); });
            };
        }, []);
        return render(props);
    };
    const remove = slots.register({ name: 'main', key: id }, Body);
    const dispose = () => { if (disposed)
        return; disposed = true; remove(); };
    try {
        layout.selectPanel(id);
    }
    catch (error) {
        dispose();
        throw error;
    }
    // The host retains registered keys and resets only a removed active key;
    // never select null here, which could close another plugin's newer panel.
    return dispose;
}
//# sourceMappingURL=main-panel-compat.js.map