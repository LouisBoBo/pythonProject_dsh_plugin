import type { KnowledgeEntry, ResolvedKnowledgeMount, KnowledgeWritebackPolicy, SearchHit } from './domain.js';
import type { KnowledgeProvider } from './provider.js';
import type { AgentLike } from './runtime.js';
interface HandlePayload {
    v: 1;
    sessionId: string;
    knowledgeBaseId: string;
    entryId: string;
}
export interface MountedSearchResult extends SearchHit {
    mount: ResolvedKnowledgeMount;
    handle: string;
}
export interface MountedBaseMatch {
    mount: ResolvedKnowledgeMount;
    score: number;
    matchedBy: string[];
}
/** Signed, session-bound entry handles prevent a model from widening its mounted scope. */
export declare class KnowledgeHandleCodec {
    private readonly secret;
    constructor(secret: Buffer);
    encode(sessionId: string, entry: KnowledgeEntry): string;
    decode(handle: string, sessionId: string): HandlePayload;
    private sign;
}
export declare function resolveRecallMounts(provider: KnowledgeProvider, agent: AgentLike, signal?: AbortSignal): Promise<ResolvedKnowledgeMount[]>;
/** Resolve the complete session mount surface; callers apply read/write policy explicitly. */
export declare function resolveKnowledgeMounts(provider: KnowledgeProvider, agent: AgentLike, signal?: AbortSignal): Promise<ResolvedKnowledgeMount[]>;
/** Search each mount with its own tag policy, then globally rank and cap the result. */
export declare function searchMountedKnowledge(provider: KnowledgeProvider, agent: AgentLike, mounts: ResolvedKnowledgeMount[], query: string, limit: number, codec: KnowledgeHandleCodec, signal?: AbortSignal): Promise<MountedSearchResult[]>;
export declare function readMountedKnowledge(provider: KnowledgeProvider, agent: AgentLike, handle: string, codec: KnowledgeHandleCodec, signal?: AbortSignal): Promise<{
    entry: KnowledgeEntry;
    mount: ResolvedKnowledgeMount;
}>;
export declare function formatMountCatalog(mounts: ResolvedKnowledgeMount[], maxChars: number, _writebackPolicy: KnowledgeWritebackPolicy): string;
export declare function selectAutomaticRecallHits(hits: MountedSearchResult[], limit: number, minScore: number): MountedSearchResult[];
export declare function formatAutomaticRecall(hits: MountedSearchResult[], maxChars: number): string;
export declare function searchMountedKnowledgeBases(mounts: ResolvedKnowledgeMount[], query: string, limit: number): MountedBaseMatch[];
export declare function formatKnowledgeBaseMatches(query: string, matches: MountedBaseMatch[]): string;
export declare function formatSearchResults(query: string, hits: MountedSearchResult[]): string;
export declare function formatKnowledgeEntry(entry: KnowledgeEntry, mount: ResolvedKnowledgeMount, offset: number, maxChars: number): string;
export declare function selectMounts(mounts: ResolvedKnowledgeMount[], requestedBase: string): ResolvedKnowledgeMount[];
export {};
//# sourceMappingURL=retrieval.d.ts.map