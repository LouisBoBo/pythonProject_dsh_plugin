import type { Editor } from '@tiptap/core';
export interface NoteFindController {
    isOpen(): boolean;
    open(): void;
    close(options?: {
        restoreEditorFocus?: boolean;
    }): void;
    destroy(): void;
}
interface NoteFindOptions {
    editor: Editor;
    frame: HTMLElement;
    onVisibilityChange?(open: boolean): void;
}
export declare function createNoteFindController(options: NoteFindOptions): NoteFindController;
export {};
//# sourceMappingURL=web-note-editor-find.d.ts.map