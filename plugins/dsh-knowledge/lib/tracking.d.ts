import type { KnowledgeProvider } from './provider.js';
import type { AgentLike } from './runtime.js';
export declare const KNOWLEDGE_TRACKING_SERVICE = "dshKnowledgeTracking";
export interface KnowledgeTrackingInput {
    id: string;
    subject: string;
    event: string;
    evidence: string;
    source: string;
    reference?: string;
    at: number;
}
export interface KnowledgeTrackingResult {
    storage: 'knowledge' | 'local';
    outcome: 'written' | 'pending-review' | 'not-mounted' | 'not-writable' | 'ambiguous';
    knowledgeBaseId?: string;
}
export interface KnowledgeTrackingSource {
    kind: 'knowledge';
    label: string;
    detail: string;
    token: string;
}
export interface KnowledgeTrackingService {
    record(agent: AgentLike, input: KnowledgeTrackingInput, signal?: AbortSignal): Promise<KnowledgeTrackingResult>;
    list(agent: AgentLike, query?: string, limit?: number, signal?: AbortSignal): Promise<KnowledgeTrackingSource[]>;
}
export declare function createKnowledgeTrackingService(provider: KnowledgeProvider): KnowledgeTrackingService;
//# sourceMappingURL=tracking.d.ts.map