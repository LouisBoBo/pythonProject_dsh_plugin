import type { Editor } from '@tiptap/core';
interface NoteSelectionMenuOptions {
    editor: Editor;
    frame: HTMLElement;
    scrollHost: HTMLElement;
    findIsOpen(): boolean;
    onExcerpt?(text: string): void;
}
export interface NoteSelectionMenuController {
    refresh(): void;
    hide(): void;
    destroy(): void;
}
export declare function createNoteSelectionMenu(options: NoteSelectionMenuOptions): NoteSelectionMenuController;
export {};
//# sourceMappingURL=web-note-editor-selection.d.ts.map