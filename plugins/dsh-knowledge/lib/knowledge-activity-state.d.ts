import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client';
/** Legacy details requires content; new docked tabs support a loaded blank session. */
export declare function availableActivitySession(state: Pick<SessionListState, 'current' | 'byId'>, docked?: boolean): string | undefined;
export interface KnowledgeActivitySelection {
    mode?: 'knowledge' | 'notes';
    knowledgeBaseId?: string | undefined;
    documentId?: string | undefined;
    noteFolderId?: string | null | undefined;
    noteDocumentId?: string | undefined;
    noteCrumbs?: {
        id: string | null;
        name: string;
    }[];
}
/** A base change cannot carry the previous base's document into the next view. */
export declare function mergeActivitySelection(previous: KnowledgeActivitySelection, next: KnowledgeActivitySelection): KnowledgeActivitySelection;
//# sourceMappingURL=knowledge-activity-state.d.ts.map