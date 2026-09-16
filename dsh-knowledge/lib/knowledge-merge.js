/** Legacy/additive merge. Revisions use explicit text edits below. */
export function mergeKnowledgeBodies(current, incoming) {
    const currentKey = normalizedBody(current);
    const incomingKey = normalizedBody(incoming);
    if (currentKey === incomingKey || currentKey.includes(incomingKey))
        return current.trim();
    if (incomingKey.includes(currentKey))
        return incoming.trim();
    return `${current.trim()}\n\n${incoming.trim()}`;
}
/**
 * Apply exact, bounded edits to a complete document.
 *
 * Exact single matches make a revision deterministic and allow the same edits
 * to be safely replayed over unrelated concurrent additions. Ambiguous or
 * missing anchors become a real review conflict instead of risking data loss.
 */
export function applyKnowledgeTextEdits(current, edits, append) {
    let body = current.replace(/\r\n?/gu, '\n');
    for (const [index, edit] of edits.entries()) {
        const oldText = edit.oldText.replace(/\r\n?/gu, '\n');
        const newText = edit.newText.replace(/\r\n?/gu, '\n');
        if (oldText.length === 0)
            return { ok: false, reason: `revision edit ${index + 1} has an empty anchor` };
        const first = body.indexOf(oldText);
        if (first < 0)
            return { ok: false, reason: `revision edit ${index + 1} no longer matches the target document` };
        if (body.indexOf(oldText, first + oldText.length) >= 0) {
            return { ok: false, reason: `revision edit ${index + 1} matches more than one location` };
        }
        body = `${body.slice(0, first)}${newText}${body.slice(first + oldText.length)}`;
    }
    const addition = append?.trim();
    if (addition)
        body = mergeKnowledgeBodies(body, addition);
    const normalized = body.trim();
    if (normalized.length === 0)
        return { ok: false, reason: 'revision would leave the document empty' };
    if (normalized.length > 50_000)
        return { ok: false, reason: 'revision would exceed the 50000 character document limit' };
    return { ok: true, body: normalized };
}
function normalizedBody(value) {
    return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
}
//# sourceMappingURL=knowledge-merge.js.map