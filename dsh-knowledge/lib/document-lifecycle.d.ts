import { type CandidateChange, type CandidateProposal, type KnowledgeEntry, type KnowledgeSource } from './domain.js';
export interface LifecycleRequest {
    state: 'resolved' | 'complete';
    confirmation: string;
    note: string;
    wholeDocument: boolean;
    oldText?: string;
    newText?: string;
}
export declare function normalizeFinalizationChange(value: unknown): Extract<CandidateChange, {
    kind: 'finalize';
}>;
/** Ground status changes in a current direct user confirmation, not an Agent claim. */
export declare function assertLifecycleConfirmation(text: string, quote: string, state: string): void;
export declare function lifecycleProposal(entry: KnowledgeEntry, request: LifecycleRequest, userText: string, source: KnowledgeSource): CandidateProposal;
//# sourceMappingURL=document-lifecycle.d.ts.map