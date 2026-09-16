import type { NoteNode, NoteShare } from './domain.js';
export interface NoteSharePageInput {
    apiPrefix: string;
    share: NoteShare;
    nodes: NoteNode[];
    selectedNode?: NoteNode;
    selectedText?: string;
    contentTruncated?: boolean;
    listTruncated?: boolean;
}
export declare function renderNoteSharePage(input: NoteSharePageInput): string;
//# sourceMappingURL=share-page.d.ts.map