/** Legacy details requires content; new docked tabs support a loaded blank session. */
export function availableActivitySession(state, docked = false) {
    const current = state.current;
    if (current === undefined || state.byId[current] === undefined)
        return undefined;
    return docked || state.byId[current]?.blank === false ? String(current) : undefined;
}
/** A base change cannot carry the previous base's document into the next view. */
export function mergeActivitySelection(previous, next) {
    const merged = { ...previous, ...next };
    if ('knowledgeBaseId' in next && next.knowledgeBaseId !== previous.knowledgeBaseId && !('documentId' in next)) {
        merged.documentId = undefined;
    }
    return merged;
}
//# sourceMappingURL=knowledge-activity-state.js.map