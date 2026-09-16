import { type JSONContent } from '@tiptap/core';
export interface MarkdownEditorOptions {
    host: HTMLElement;
    frame?: HTMLElement;
    scrollHost?: HTMLElement;
    outlineHost?: HTMLElement;
    findButton?: HTMLButtonElement | null;
    outlineButton?: HTMLButtonElement | null;
    markdown: string;
    label: string;
    onChange(markdown: string): void;
    onSave(): void;
    onExcerpt?(text: string): void;
    onOpenNote?(id: string): void;
}
export interface MarkdownEditorHandle {
    getMarkdown(): string;
    focus(): void;
    insertMarkdown(markdown: string): void;
    openFind(): void;
    toggleOutline(): void;
    destroy(): void;
}
export interface PlainTextEditorOptions {
    host: HTMLElement;
    text: string;
    label: string;
    onChange(text: string): void;
    onSave(): void;
}
export interface PlainTextEditorHandle {
    focus(): void;
    destroy(): void;
}
/**
 * Mount a Markdown-native rich text editor into the notes workspace.
 *
 * The management application owns loading and persistence. This module owns
 * only Markdown parsing, editing and serialization so its lifecycle remains
 * independent from the surrounding vanilla DOM renderer.
 */
export declare function createMarkdownEditor(options: MarkdownEditorOptions): MarkdownEditorHandle;
/**
 * Mount a document-shaped plain-text editor.
 *
 * Each stored line is represented by one paragraph node. Visual wrapping stays
 * inside that paragraph, so the UI can number logical lines without measuring
 * rendered text or interfering with the browser selection.
 */
export declare function createPlainTextEditor(options: PlainTextEditorOptions): PlainTextEditorHandle;
export declare function plainTextToDocument(text: string): JSONContent;
export declare function plainTextFromDocument(document: JSONContent): string;
//# sourceMappingURL=web-note-editor.d.ts.map