import type { Context as ClientContext } from '@deepseek-ai/cordis';
export interface KnowledgeWorkspaceController {
    isOpen(): boolean;
    open(): void;
    toggle(): void;
    openDocument(target: KnowledgeDocumentTarget): void;
    currentTarget(): KnowledgeDocumentTarget | undefined;
    close(): void;
    subscribe(listener: () => void): () => void;
}
export type KnowledgeDocumentTarget = {
    view?: 'entries';
    knowledgeBaseId: string;
    documentId: string;
} | {
    view: 'notes';
    noteId?: string;
} | {
    view: 'writeback';
    sessionId: string;
};
/** Cordis services needed by the browser half. */
export declare const inject: string[];
/** Register the knowledge launcher in the sidebar's official extension slot. */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=client.d.ts.map