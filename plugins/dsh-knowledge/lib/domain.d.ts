export declare const KNOWLEDGE_TYPES: readonly ["preference", "fact", "decision", "procedure", "lesson"];
export type KnowledgeType = typeof KNOWLEDGE_TYPES[number];
export declare const DEFAULT_KNOWLEDGE_BASE_ID = "default";
export type KnowledgeScope = {
    kind: 'global';
} | {
    kind: 'project';
    id: string;
};
export type KnowledgeStatus = 'active' | 'archived';
export declare const KNOWLEDGE_DOCUMENT_STATES: readonly ["open", "resolved", "complete"];
export type KnowledgeDocumentState = typeof KNOWLEDGE_DOCUMENT_STATES[number];
export type CandidateAction = 'create' | 'update' | 'conflict';
export type CandidateStatus = 'pending' | 'approved' | 'rejected';
export type KnowledgeBaseStatus = 'active' | 'archived';
export type KnowledgeMountTargetKind = 'project' | 'session';
export type KnowledgeWriteMode = 'none' | 'audit' | 'direct';
export type KnowledgeWritebackPolicy = 'conservative' | 'proactive';
export type KnowledgeEvidence = 'explicit' | 'verified' | 'inferred';
export interface KnowledgeTextEdit {
    /** Exact text from the target document. It must occur exactly once. */
    oldText: string;
    /** Replacement text. An empty value removes oldText. */
    newText: string;
}
export type CandidateChange = {
    kind: 'append';
} | {
    kind: 'finalize';
    baseVersion: number;
    baseHash: string;
    state: 'resolved' | 'complete';
    note: string;
    confirmation: string;
} | {
    kind: 'revise';
    baseVersion: number;
    baseHash: string;
    edits: KnowledgeTextEdit[];
    append?: string;
};
export interface KnowledgeSettings {
    writebackPolicy: KnowledgeWritebackPolicy;
    writebackProvider?: string;
    writebackModel?: string;
    updatedAt: string;
}
export interface KnowledgeSettingsPatch {
    writebackPolicy?: KnowledgeWritebackPolicy;
    writebackProvider?: string | null;
    writebackModel?: string | null;
}
export interface KnowledgeBaseDraft {
    name: string;
    /** Display-only organization; never changes recall or write permissions. */
    group?: string;
    description: string;
    defaultTags: string[];
    extractionInstructions: string;
    writebackPolicy: KnowledgeWritebackPolicy;
    /** Empty means use the model route from the current assistant turn. */
    writebackProvider?: string;
    writebackModel?: string;
}
export interface KnowledgeBasePatch {
    name?: string;
    group?: string | null;
    description?: string;
    defaultTags?: string[];
    extractionInstructions?: string;
    writebackPolicy?: KnowledgeWritebackPolicy;
    writebackProvider?: string | null;
    writebackModel?: string | null;
}
export interface KnowledgeBase extends KnowledgeBaseDraft {
    id: string;
    status: KnowledgeBaseStatus;
    createdAt: string;
    updatedAt: string;
}
/** User-facing Markdown projection of approved knowledge entries. */
export interface KnowledgeDocument {
    id: string;
    knowledgeBaseId: string;
    relPath: string;
    title: string;
    content: string;
    entryCount: number;
    contentHash: string;
    documentState: KnowledgeDocumentState;
    finalizedAt?: string;
    finalizationNote?: string;
    createdAt: string;
    updatedAt: string;
}
export type KnowledgeDocumentSummary = Omit<KnowledgeDocument, 'content'>;
export interface KnowledgeDocumentIndexRequest {
    knowledgeBaseIds?: string[];
    activeKnowledgeBasesOnly?: boolean;
    query?: string;
    cursor?: string;
    limit: number;
}
export interface KnowledgeDocumentIndexResult {
    items: KnowledgeDocumentSummary[];
    total: number;
    nextCursor?: string;
}
export interface KnowledgeMountDraft {
    targetKind: KnowledgeMountTargetKind;
    targetId: string;
    knowledgeBaseId: string;
    enabled: boolean;
    recallEnabled: boolean;
    writeMode: KnowledgeWriteMode;
    includeTags: string[];
    excludeTags: string[];
    extractionInstructions: string;
}
export interface KnowledgeMount extends KnowledgeMountDraft {
    id: string;
    createdAt: string;
    updatedAt: string;
}
export interface KnowledgeMountBatch {
    upserts: KnowledgeMountDraft[];
    deleteIds: string[];
}
export interface KnowledgeMountBatchResult {
    mounts: KnowledgeMount[];
    deletedIds: string[];
}
export interface ResolvedKnowledgeMount extends KnowledgeMount {
    base: KnowledgeBase;
    inheritedFrom?: 'project';
}
export interface KnowledgeSource {
    sessionId?: string;
    messageId?: string;
    turn?: number;
    clientId?: string;
    evidence?: KnowledgeEvidence;
}
export interface KnowledgeDraft {
    knowledgeBaseId: string;
    title: string;
    body: string;
    type: KnowledgeType;
    tags: string[];
    scope: KnowledgeScope;
    confidence: number;
    source?: KnowledgeSource;
}
export interface KnowledgeEntry extends KnowledgeDraft {
    id: string;
    status: KnowledgeStatus;
    documentState: KnowledgeDocumentState;
    finalizedAt?: string;
    finalizationNote?: string;
    version: number;
    createdAt: string;
    updatedAt: string;
}
export interface KnowledgeVersion {
    id: string;
    knowledgeId: string;
    version: number;
    snapshot: KnowledgeDraft & {
        status: KnowledgeStatus;
        documentState: KnowledgeDocumentState;
        finalizedAt?: string;
        finalizationNote?: string;
    };
    changeKind: 'create' | 'update' | 'archive' | 'restore';
    createdAt: string;
}
export interface CandidateProposal {
    action: CandidateAction;
    targetId?: string;
    /** Missing on legacy candidates and treated as an append. */
    change?: CandidateChange;
    draft: KnowledgeDraft;
    reason: string;
}
export interface KnowledgeCandidate extends CandidateProposal {
    id: string;
    status: CandidateStatus;
    sourceKey?: string;
    createdAt: string;
    reviewedAt?: string;
    reviewNote?: string;
}
export type DirectWriteOutcome = 'created' | 'merged' | 'duplicate' | 'conflict' | 'finalized';
export interface DirectWriteResult {
    outcome: DirectWriteOutcome;
    candidate?: KnowledgeCandidate;
    entry?: KnowledgeEntry;
}
export interface SearchRequest {
    text: string;
    projectId?: string;
    knowledgeBaseIds?: string[];
    includeTags?: string[];
    excludeTags?: string[];
    types?: KnowledgeType[];
    limit: number;
}
export interface SearchHit {
    entry: KnowledgeEntry;
    score: number;
}
export interface ListRequest {
    status?: KnowledgeStatus;
    projectId?: string;
    knowledgeBaseId?: string;
    type?: KnowledgeType;
    limit: number;
    cursor?: string;
}
export interface ListResult<T> {
    items: T[];
    nextCursor?: string;
}
export interface ReviewDecision {
    decision: 'approve' | 'reject';
    resolution?: 'merge';
    note?: string;
    draft?: KnowledgeDraft;
    /** Version shown to the reviewer when an edited full document is submitted. */
    expectedVersion?: number;
}
export interface CandidateBatchReviewFailure {
    id: string;
    error: string;
}
/** Result of one bounded pass over automatically reviewable pending candidates. */
export interface CandidateBatchReviewResult {
    selected: number;
    approved: number;
    deferred: number;
    failed: CandidateBatchReviewFailure[];
    /** Pending non-conflict candidates not excluded by the caller. */
    remainingReviewable: number;
    /** Conflicts and caller-excluded failures that still require attention. */
    remainingManual: number;
}
export interface ExtractionJobRecord {
    sourceKey: string;
    status: 'running' | 'completed' | 'failed';
    attempts: number;
    candidateCount: number;
    lastError?: string;
    completion?: ExtractionJobCompletion;
    updatedAt: string;
}
export interface ExtractionWriteDestination {
    knowledgeBaseId: string;
    knowledgeBaseName: string;
    documentId?: string;
    documentTitle: string;
    documentPath?: string;
    disposition: 'written' | 'pending-review';
    documentState?: 'resolved' | 'complete';
}
export interface ExtractionJobCompletion {
    outcome: 'completed' | 'skipped' | 'unmounted';
    candidateCount: number;
    directCount: number;
    auditCount: number;
    destinations: ExtractionWriteDestination[];
}
export interface KnowledgeStats {
    knowledgeBases: {
        total: number;
        active: number;
        archived: number;
    };
    entries: {
        total: number;
        active: number;
        archived: number;
        byType: Record<KnowledgeType, number>;
    };
    candidates: {
        total: number;
        pending: number;
        approved: number;
        rejected: number;
    };
    extractionJobs: {
        total: number;
        running: number;
        completed: number;
        failed: number;
    };
}
export declare const TOKEN_PERMISSIONS: readonly ["read", "propose", "write", "admin"];
export type TokenPermission = typeof TOKEN_PERMISSIONS[number];
export interface ApiTokenRecord {
    id: string;
    name: string;
    permissions: TokenPermission[];
    createdAt: string;
    lastUsedAt?: string;
    revokedAt?: string;
}
export declare function newId(): string;
export declare function nowIso(): string;
export declare function normalizeTags(tags: readonly string[]): string[];
export declare function normalizeDraft(input: KnowledgeDraft): KnowledgeDraft;
export declare function contentHash(draft: KnowledgeDraft): string;
export declare function normalizeKnowledgeBaseGroup(value: unknown): string;
export declare function normalizeKnowledgeBaseDraft(input: KnowledgeBaseDraft): KnowledgeBaseDraft;
export declare function normalizeKnowledgeMountDraft(input: KnowledgeMountDraft): KnowledgeMountDraft;
export declare function isKnowledgeType(value: unknown): value is KnowledgeType;
export declare function normalizeKnowledgeSettings(input: KnowledgeSettingsPatch): KnowledgeSettingsPatch;
//# sourceMappingURL=domain.d.ts.map