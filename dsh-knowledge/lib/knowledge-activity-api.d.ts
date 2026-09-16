import type { KnowledgeDocument, KnowledgeDocumentIndexResult, ResolvedKnowledgeMount } from './domain.js';
import type { NoteNode } from './notes/domain.js';
export interface KnowledgeActivityNoteContent {
    node: NoteNode;
    content: string;
}
export declare function loadMountedKnowledge(sessionId: string, projectId: string | undefined, signal?: AbortSignal): Promise<ResolvedKnowledgeMount[]>;
export declare function loadKnowledgeDocumentIndex(input: {
    sessionId: string;
    projectId?: string;
    knowledgeBaseIds: string[];
    query?: string;
    cursor?: string;
    signal?: AbortSignal;
}): Promise<KnowledgeDocumentIndexResult>;
export declare function loadNoteIndex(input: {
    sessionId: string;
    projectId?: string;
    parentId?: string | null;
    query?: string;
    signal?: AbortSignal;
}): Promise<NoteNode[]>;
export declare function loadNoteContent(input: {
    id: string;
    sessionId: string;
    projectId?: string;
    signal?: AbortSignal;
}): Promise<KnowledgeActivityNoteContent>;
export declare function loadKnowledgeDocument(input: {
    id: string;
    sessionId: string;
    projectId?: string;
    signal?: AbortSignal;
}): Promise<KnowledgeDocument>;
//# sourceMappingURL=knowledge-activity-api.d.ts.map