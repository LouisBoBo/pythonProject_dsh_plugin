import type { ResolvedConfig } from './config.js';
import { type CandidateProposal, type ExtractionWriteDestination } from './domain.js';
import type { KnowledgeProvider } from './provider.js';
import { type RuntimeContextLike, type SessionLike } from './runtime.js';
export interface TurnSnapshot {
    sourceKey: string;
    sessionId: string;
    turn: number;
    projectId?: string;
    userText: string;
    userTextTruncated: boolean;
    assistantText: string;
    assistantMessageId?: string;
    route?: {
        provider: string;
        model: string;
    };
}
export interface PlannedWrite {
    proposal: CandidateProposal;
    delivery: 'direct' | 'audit';
}
export interface ExtractionCheckpoint {
    load(): PlannedWrite[] | undefined;
    save(proposals: PlannedWrite[]): void;
}
export declare class ExtractionCoordinator {
    private readonly ctx;
    private readonly provider;
    private readonly config;
    private readonly clientRoute;
    private closing;
    private readonly shutdown;
    constructor(ctx: RuntimeContextLike, provider: KnowledgeProvider, config: ResolvedConfig, clientRoute?: () => {
        provider: string;
        model: string;
    } | undefined);
    run(session: SessionLike, turn: number, parentSignal: AbortSignal): Promise<ExtractionResult>;
    capture(session: SessionLike, turn: number): TurnSnapshot | undefined;
    runSnapshot(snapshot: TurnSnapshot, parentSignal: AbortSignal, checkpoint?: ExtractionCheckpoint): Promise<ExtractionResult>;
    close(): Promise<void>;
    private completeEmpty;
    private process;
}
export interface ExtractionResult {
    status: 'completed' | 'skipped' | 'unmounted' | 'duplicate';
    candidateCount: number;
    directCount: number;
    auditCount: number;
    bases: Array<{
        knowledgeBaseId: string;
        name: string;
        directCount: number;
        auditCount: number;
    }>;
    destinations: ExtractionWriteDestination[];
}
//# sourceMappingURL=extraction.d.ts.map