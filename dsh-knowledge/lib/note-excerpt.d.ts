export interface NoteExcerptRequest {
    requestId: string;
    noteId: string;
    text: string;
    knowledgeBaseId: string;
    documentId?: string;
    expectedVersion?: number;
    title?: string;
}
/** Plain selected text must not introduce Markdown/HTML or a second link. */
export declare function noteExcerptMarkdown(noteId: string, text: string): string;
//# sourceMappingURL=note-excerpt.d.ts.map