export type NoteNodeKind = 'folder' | 'document' | 'file';
export interface NoteNode {
    id: string;
    parentId: string | null;
    kind: NoteNodeKind;
    name: string;
    mediaType: string | null;
    editable: boolean;
    size: number;
    sha256: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
}
export interface NoteVersion {
    noteId: string;
    version: number;
    name: string;
    mediaType: string | null;
    size: number;
    sha256: string;
    createdAt: string;
}
export interface NoteShare {
    id: string;
    noteId: string;
    token: string;
    createdAt: string;
    updatedAt: string;
    node: NoteNode;
}
export interface NoteReference {
    noteId: string;
    knowledgeBaseId: string;
    documentId: string;
    documentTitle: string;
}
export type KnowledgeNoteReferenceSource = 'user' | 'agent' | 'legacy';
export interface KnowledgeNoteReference {
    knowledgeId: string;
    knowledgeBaseId: string;
    documentTitle: string;
    note: NoteNode;
    source: KnowledgeNoteReferenceSource;
    sourceSessionId?: string;
    createdAt: string;
}
export interface NoteListRequest {
    parentId?: string | null;
    query?: string;
    limit?: number;
}
export interface NoteFileUpload {
    parentId?: string | null;
    name: string;
    mediaType: string;
    content: Uint8Array;
}
export declare function isNoteId(value: string): boolean;
export declare function isEditableNoteNode(node: Pick<NoteNode, 'kind' | 'name' | 'mediaType'>): boolean;
export declare function noteReferenceMarkdown(node: Pick<NoteNode, 'id' | 'name'>): string;
//# sourceMappingURL=domain.d.ts.map