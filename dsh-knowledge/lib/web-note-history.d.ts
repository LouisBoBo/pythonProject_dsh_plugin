export interface NoteHistoryItem {
    noteId: string;
    version: number;
    name: string;
    mediaType: string | null;
    size: number;
    sha256: string;
    createdAt: string;
}
interface NoteHistoryViewOptions {
    versions: NoteHistoryItem[];
    currentVersion: number;
    currentContent: string;
    loadContent(version: NoteHistoryItem, signal: AbortSignal): Promise<string>;
    renderPreview(content: string): HTMLElement;
    renderDiff(historical: string, current: string): HTMLElement;
    formatDate(value: string): string;
    formatBytes(value: number): string;
    onRestore(version: NoteHistoryItem, content: string): Promise<void>;
    onError(error: unknown): void;
}
export interface NoteHistoryView {
    element: HTMLElement;
    destroy(): void;
}
export declare function createNoteHistoryView(options: NoteHistoryViewOptions): NoteHistoryView;
export {};
//# sourceMappingURL=web-note-history.d.ts.map