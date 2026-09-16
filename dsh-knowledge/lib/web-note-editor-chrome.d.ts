import type { Editor } from '@tiptap/core';
interface NoteEditorChromeOptions {
    editor: Editor;
    frame: HTMLElement;
    scrollHost: HTMLElement;
    outlineHost: HTMLElement;
    findButton?: HTMLButtonElement | null;
    outlineButton?: HTMLButtonElement | null;
    onExcerpt?(text: string): void;
}
export interface NoteEditorChrome {
    openFind(): void;
    toggleOutline(): void;
    destroy(): void;
}
export declare function createNoteEditorChrome(options: NoteEditorChromeOptions): NoteEditorChrome;
export {};
//# sourceMappingURL=web-note-editor-chrome.d.ts.map