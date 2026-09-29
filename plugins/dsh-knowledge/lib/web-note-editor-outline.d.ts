import type { Editor } from '@tiptap/core';
interface NoteOutlineOptions {
    editor: Editor;
    frame: HTMLElement;
    host: HTMLElement;
    scrollHost: HTMLElement;
    toggleButton?: HTMLButtonElement | null;
}
export interface NoteOutlineController {
    toggle(): void;
    close(): void;
    destroy(): void;
}
export declare function calculateHeadingScrollTop(currentScrollTop: number, targetTop: number, scrollHostTop: number, maximumScrollTop: number, inset?: number): number;
export declare function createNoteOutlineController(options: NoteOutlineOptions): NoteOutlineController;
export {};
//# sourceMappingURL=web-note-editor-outline.d.ts.map