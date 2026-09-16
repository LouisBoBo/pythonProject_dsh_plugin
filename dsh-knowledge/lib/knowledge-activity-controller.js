import { jsx as _jsx } from "react/jsx-runtime";
import { KnowledgeActivityPanel } from './knowledge-activity-panel.js';
import { KnowledgeActivityPresentation } from './knowledge-activity-presentation.js';
import { createDockedPanel, supportsDockedPanels } from './docked-panel-compat.js';
import { mergeActivitySelection } from './knowledge-activity-state.js';
export function createKnowledgeActivityController(ctx, options) {
    if (supportsDockedPanels(ctx))
        return createDockedKnowledgeController(ctx, options);
    const runtime = ctx;
    const listeners = new Set();
    const states = new Map();
    let currentSessionId = normalizeSessionId(runtime.sessions.list.getSnapshot().current);
    let mountedSessionId;
    let restoreFrame;
    let disposePanel;
    const notify = () => { for (const listener of listeners)
        listener(); };
    const cancelRestore = () => {
        if (restoreFrame === undefined)
            return;
        window.cancelAnimationFrame(restoreFrame);
        restoreFrame = undefined;
    };
    const unmount = () => {
        if (disposePanel === undefined)
            return false;
        const dispose = disposePanel;
        disposePanel = undefined;
        mountedSessionId = undefined;
        dispose();
        return true;
    };
    const mount = (sessionId, openDetails = true) => {
        if (mountedSessionId === sessionId && disposePanel !== undefined) {
            if (openDetails)
                ctx.layout.openDetails();
            return;
        }
        unmount();
        mountedSessionId = sessionId;
        const onClosed = () => {
            if (mountedSessionId === sessionId && states.get(sessionId)?.open !== true)
                unmount();
        };
        disposePanel = ctx.slots.register({ name: 'details', priority: -3 }, props => (_jsx(KnowledgeActivityPresentation, { sessionId: sessionId, controller: controller, onClosed: onClosed, children: _jsx(KnowledgeActivityPanel, { ...props, controller: controller }) }, sessionId)));
        if (openDetails)
            ctx.layout.openDetails();
    };
    const syncCurrentSession = () => {
        const nextSessionId = normalizeSessionId(runtime.sessions.list.getSnapshot().current);
        if (nextSessionId === currentSessionId)
            return;
        cancelRestore();
        const wasMounted = unmount();
        currentSessionId = nextSessionId;
        if (nextSessionId !== undefined && states.get(nextSessionId)?.open === true) {
            mount(nextSessionId, false);
            restoreFrame = window.requestAnimationFrame(() => {
                restoreFrame = undefined;
                if (currentSessionId === nextSessionId && mountedSessionId === nextSessionId && states.get(nextSessionId)?.open === true) {
                    ctx.layout.openDetails();
                }
            });
        }
        else if (wasMounted) {
            ctx.layout.closeDetails();
        }
        notify();
    };
    const controller = {
        open(sessionId, selection) {
            const previous = states.get(sessionId);
            states.set(sessionId, { ...mergeActivitySelection(previous ?? {}, selection ?? {}), open: true });
            options.beforeOpen();
            if (sessionId === currentSessionId) {
                cancelRestore();
                mount(sessionId);
            }
            notify();
        },
        toggle(sessionId) {
            if (states.get(sessionId)?.open === true)
                controller.close(sessionId);
            else
                controller.open(sessionId);
        },
        close(sessionId, immediate = false) {
            const target = sessionId ?? currentSessionId;
            if (target === undefined)
                return;
            const previous = states.get(target) ?? { open: false };
            states.set(target, { ...previous, open: false });
            if (target === currentSessionId) {
                cancelRestore();
                if (mountedSessionId === target)
                    ctx.layout.closeDetails();
                if (immediate)
                    unmount();
            }
            notify();
        },
        isOpen: sessionId => states.get(sessionId)?.open === true,
        selection(sessionId) {
            const state = states.get(sessionId);
            return {
                ...state?.mode === undefined ? {} : { mode: state.mode },
                ...state?.knowledgeBaseId === undefined ? {} : { knowledgeBaseId: state.knowledgeBaseId },
                ...state?.documentId === undefined ? {} : { documentId: state.documentId },
                ...state?.noteFolderId === undefined ? {} : { noteFolderId: state.noteFolderId },
                ...state?.noteDocumentId === undefined ? {} : { noteDocumentId: state.noteDocumentId },
                ...state?.noteCrumbs === undefined ? {} : { noteCrumbs: state.noteCrumbs },
            };
        },
        select(sessionId, selection) {
            const previous = states.get(sessionId) ?? { open: true };
            states.set(sessionId, { ...mergeActivitySelection(previous, selection), open: previous.open });
            notify();
        },
        openWorkspace(target) {
            controller.close(undefined, true);
            options.openWorkspace(target);
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        dispose() {
            disposeSelection();
            cancelRestore();
            unmount();
            states.clear();
            listeners.clear();
        },
    };
    const disposeSelection = runtime.sessions.list.subscribe(syncCurrentSession);
    return controller;
}
function normalizeSessionId(value) {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
/** New hosts persist right-hand tabs per session; do not remount a global details slot. */
function createDockedKnowledgeController(ctx, options) {
    const selections = new Map();
    const listeners = new Set();
    const notify = () => { for (const listener of listeners)
        listener(); };
    const current = () => normalizeSessionId(ctx.sessions.list.getSnapshot().current);
    const panel = createDockedPanel(ctx, '@zhongruan/dsh-knowledge/activity', '知识库', props => _jsx(KnowledgeActivityPanel, { ...props, controller: controller }), notify);
    const controller = {
        open(sessionId, selection) {
            if (selection !== undefined)
                controller.select(sessionId, selection);
            options.beforeOpen();
            panel.open(sessionId);
        },
        toggle(sessionId) { if (panel.isOpen(sessionId))
            controller.close(sessionId);
        else
            controller.open(sessionId); },
        close(sessionId) { const target = sessionId ?? current(); if (target !== undefined)
            panel.close(target); },
        isOpen: panel.isOpen,
        selection: sessionId => selections.get(sessionId) ?? {},
        select(sessionId, selection) {
            selections.set(sessionId, mergeActivitySelection(selections.get(sessionId) ?? {}, selection));
            notify();
        },
        openWorkspace(target) { controller.close(); options.openWorkspace(target); },
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        dispose() { panel.dispose(); selections.clear(); listeners.clear(); },
    };
    return controller;
}
//# sourceMappingURL=knowledge-activity-controller.js.map