import type { Context as ClientContext } from '@deepseek-ai/cordis';
import type { KnowledgeDocumentTarget } from './client.js';
export type { KnowledgeActivitySelection } from './knowledge-activity-state.js';
import { type KnowledgeActivitySelection } from './knowledge-activity-state.js';
export interface KnowledgeActivityController {
    open(sessionId: string, selection?: KnowledgeActivitySelection): void;
    toggle(sessionId: string): void;
    close(sessionId?: string, immediate?: boolean): void;
    isOpen(sessionId: string): boolean;
    selection(sessionId: string): KnowledgeActivitySelection;
    select(sessionId: string, selection: KnowledgeActivitySelection): void;
    openWorkspace(target?: KnowledgeDocumentTarget): void;
    subscribe(listener: () => void): () => void;
    dispose(): void;
}
export declare function createKnowledgeActivityController(ctx: ClientContext, options: {
    beforeOpen(): void;
    openWorkspace(target?: KnowledgeDocumentTarget): void;
}): KnowledgeActivityController;
//# sourceMappingURL=knowledge-activity-controller.d.ts.map