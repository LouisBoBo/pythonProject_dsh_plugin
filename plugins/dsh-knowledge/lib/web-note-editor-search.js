import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
const MAX_QUERY_LENGTH = 256;
const MAX_RESULTS = 1_000;
export const noteSearchPluginKey = new PluginKey('dshKnowledgeNoteSearch');
function normalizeQuery(query) {
    return query.slice(0, MAX_QUERY_LENGTH);
}
function clampActiveIndex(index, resultCount) {
    if (resultCount === 0)
        return 0;
    return Math.max(0, Math.min(Math.trunc(index), resultCount - 1));
}
/** Finds literal matches per text block, including text split across inline marks. */
export function findNoteSearchRanges(document, rawQuery, caseSensitive) {
    const query = normalizeQuery(rawQuery);
    if (!query)
        return [];
    const needle = caseSensitive ? query : query.toLocaleLowerCase();
    const results = [];
    document.descendants((node, position) => {
        if (!node.isTextblock || results.length >= MAX_RESULTS)
            return results.length < MAX_RESULTS;
        let segment = '';
        let segmentOffset = 0;
        const flush = () => {
            if (!segment)
                return;
            const haystack = caseSensitive ? segment : segment.toLocaleLowerCase();
            let offset = 0;
            while (offset <= haystack.length - needle.length && results.length < MAX_RESULTS) {
                const match = haystack.indexOf(needle, offset);
                if (match < 0)
                    break;
                const from = position + 1 + segmentOffset + match;
                results.push({ from, to: from + query.length });
                offset = match + Math.max(1, needle.length);
            }
            segment = '';
        };
        node.forEach((child, offset) => {
            if (!child.isText) {
                flush();
                return;
            }
            if (!segment)
                segmentOffset = offset;
            else if (offset !== segmentOffset + segment.length) {
                flush();
                segmentOffset = offset;
            }
            segment += child.text ?? '';
        });
        flush();
        if (results.length >= MAX_RESULTS) {
            return false;
        }
        return false;
    });
    return results;
}
function buildDecorations(document, results, activeIndex) {
    return DecorationSet.create(document, results.map((range, index) => Decoration.inline(range.from, range.to, {
        class: index === activeIndex ? 'notes-search-result notes-search-result-current' : 'notes-search-result',
        'data-note-search-result': index === activeIndex ? 'current' : 'match',
    })));
}
function nextSearchState(transaction, previous) {
    const meta = transaction.getMeta(noteSearchPluginKey);
    if (!transaction.docChanged && !meta)
        return previous;
    const query = normalizeQuery(meta?.query ?? previous.query);
    const caseSensitive = meta?.caseSensitive ?? previous.caseSensitive;
    const mustRescan = transaction.docChanged || query !== previous.query || caseSensitive !== previous.caseSensitive;
    const results = mustRescan
        ? findNoteSearchRanges(transaction.doc, query, caseSensitive)
        : previous.results;
    const requestedIndex = meta?.activeIndex ?? previous.activeIndex;
    const activeIndex = clampActiveIndex(requestedIndex, results.length);
    return {
        query,
        caseSensitive,
        activeIndex,
        results,
        decorations: buildDecorations(transaction.doc, results, activeIndex),
    };
}
export const NoteSearch = Extension.create({
    name: 'dshKnowledgeNoteSearch',
    addProseMirrorPlugins() {
        return [new Plugin({
                key: noteSearchPluginKey,
                state: {
                    init: (_, state) => ({
                        query: '',
                        caseSensitive: false,
                        activeIndex: 0,
                        results: [],
                        decorations: DecorationSet.empty,
                    }),
                    apply: nextSearchState,
                },
                props: {
                    decorations: state => noteSearchPluginKey.getState(state)?.decorations ?? DecorationSet.empty,
                },
            })];
    },
});
export function getNoteSearchState(editor) {
    return noteSearchPluginKey.getState(editor.state);
}
export function updateNoteSearch(editor, meta) {
    if (editor.isDestroyed)
        return;
    editor.view.dispatch(editor.state.tr.setMeta(noteSearchPluginKey, meta));
}
export function replaceNoteSearchResult(editor, range, replacement) {
    if (editor.isDestroyed)
        return;
    const transaction = editor.state.tr;
    if (replacement)
        transaction.replaceWith(range.from, range.to, editor.state.schema.text(replacement, editor.state.doc.resolve(range.from).marks()));
    else
        transaction.delete(range.from, range.to);
    editor.view.dispatch(transaction);
}
export function replaceAllNoteSearchResults(editor, ranges, replacement) {
    if (editor.isDestroyed || ranges.length === 0)
        return;
    const transaction = editor.state.tr;
    for (let index = ranges.length - 1; index >= 0; index -= 1) {
        const range = ranges[index];
        if (!range)
            continue;
        if (replacement)
            transaction.replaceWith(range.from, range.to, editor.state.schema.text(replacement, editor.state.doc.resolve(range.from).marks()));
        else
            transaction.delete(range.from, range.to);
    }
    editor.view.dispatch(transaction);
}
//# sourceMappingURL=web-note-editor-search.js.map