import { Extension, type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { PluginKey } from '@tiptap/pm/state';
import { DecorationSet } from '@tiptap/pm/view';
export interface NoteSearchRange {
    from: number;
    to: number;
}
export interface NoteSearchState {
    query: string;
    caseSensitive: boolean;
    activeIndex: number;
    results: NoteSearchRange[];
    decorations: DecorationSet;
}
interface NoteSearchMeta {
    query?: string;
    caseSensitive?: boolean;
    activeIndex?: number;
}
export declare const noteSearchPluginKey: PluginKey<NoteSearchState>;
/** Finds literal matches per text block, including text split across inline marks. */
export declare function findNoteSearchRanges(document: ProseMirrorNode, rawQuery: string, caseSensitive: boolean): NoteSearchRange[];
export declare const NoteSearch: Extension<any, any>;
export declare function getNoteSearchState(editor: Editor): NoteSearchState | undefined;
export declare function updateNoteSearch(editor: Editor, meta: NoteSearchMeta): void;
export declare function replaceNoteSearchResult(editor: Editor, range: NoteSearchRange, replacement: string): void;
export declare function replaceAllNoteSearchResults(editor: Editor, ranges: NoteSearchRange[], replacement: string): void;
export {};
//# sourceMappingURL=web-note-editor-search.d.ts.map