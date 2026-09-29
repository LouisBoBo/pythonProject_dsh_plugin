import type { ResolvedConfig } from './config.js';
import type { KnowledgeProvider } from './provider.js';
import { KnowledgeHandleCodec } from './retrieval.js';
import { type RuntimeContextLike } from './runtime.js';
/**
 * Sanitize prior plugin surface messages, then perform bounded first-step
 * retrieval for the current direct user request. The injected recall snapshot
 * is discarded from later model steps and never becomes write-back evidence.
 */
export declare function registerKnowledgeRecall(ctx: RuntimeContextLike, provider: KnowledgeProvider, config: ResolvedConfig, codec: KnowledgeHandleCodec): () => void;
/** Add a bounded, per-agent knowledge map through DSH's official prompt assembly waterfall. */
export declare function registerKnowledgeCatalog(ctx: RuntimeContextLike, provider: KnowledgeProvider, config: ResolvedConfig): () => void;
//# sourceMappingURL=recall.d.ts.map