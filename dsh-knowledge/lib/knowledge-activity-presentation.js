import { jsx as _jsx } from "react/jsx-runtime";
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
/** Expand the requested host column once, then reveal our reader with a transform.
 * Avoid reflowing the conversation on every opening frame. No host styles or
 * transition settings are changed; only the in-flight column transition finishes.
 * Closing retains a stable reader width until the host releases the column.
 */
export function KnowledgeActivityPresentation({ controller, sessionId, onClosed, children }) {
    const root = useRef(null);
    const open = useSyncExternalStore(controller.subscribe, () => controller.isOpen(sessionId));
    useLayoutEffect(() => {
        const viewport = root.current;
        const panel = viewport?.firstElementChild;
        if (!viewport || !panel)
            return;
        let cancelled = false;
        let timeout;
        let reveal;
        const width = panel.getBoundingClientRect().width;
        panel.style.width = `${width > 1 ? width : 360}px`;
        viewport.toggleAttribute('inert', !open);
        const settle = () => {
            if (cancelled)
                return;
            cancelled = true;
            if (timeout !== undefined)
                clearTimeout(timeout);
            reveal?.cancel();
            panel.style.removeProperty('width');
            if (!open)
                onClosed();
        };
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!open && reducedMotion) {
            settle();
            return;
        }
        const frame = requestAnimationFrame(() => {
            const transitions = [];
            for (let parent = viewport.parentElement; parent; parent = parent.parentElement) {
                for (const animation of parent.getAnimations()) {
                    if ('transitionProperty' in animation && animation.transitionProperty === 'grid-template-columns')
                        transitions.push(animation);
                }
                if (transitions.length > 0)
                    break;
            }
            if (open && transitions.length > 0) {
                // These are the ancestor column transitions initiated by openDetails().
                // Do not alter unrelated animations, other slots, or future transitions.
                for (const transition of transitions)
                    transition.finish();
                panel.style.removeProperty('width');
                if (!reducedMotion) {
                    reveal = panel.animate([
                        { transform: 'translateX(100%)' },
                        { transform: 'translateX(0)' },
                    ], { duration: 180, easing: 'cubic-bezier(.22, 1, .36, 1)' });
                }
            }
            // A bounded fallback covers detached/cancelled host transitions. It is not
            // a fixed delay: no-motion layouts settle in the first animation frame.
            timeout = setTimeout(settle, 1000);
            void Promise.allSettled((reveal ? [reveal] : transitions).map(animation => animation.finished)).then(settle);
        });
        return () => {
            cancelled = true;
            cancelAnimationFrame(frame);
            if (timeout !== undefined)
                clearTimeout(timeout);
            reveal?.cancel();
            panel.style.removeProperty('width');
        };
    }, [open, onClosed]);
    return _jsx("div", { ref: root, className: "dsh-knowledge-activity-viewport", "aria-hidden": !open || undefined, children: children });
}
//# sourceMappingURL=knowledge-activity-presentation.js.map