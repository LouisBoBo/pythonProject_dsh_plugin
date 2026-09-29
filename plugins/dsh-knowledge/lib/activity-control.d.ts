import type { KnowledgeProvider } from './provider.js';
import type { RuntimeContextLike } from './runtime.js';
export declare const KNOWLEDGE_ACTIVITY_PATH = "/knowledge-control/v1/activity";
/** Same-origin, read-only surface for the conversation details panel. */
export declare function registerKnowledgeActivityControl(ctx: RuntimeContextLike, provider: KnowledgeProvider): () => void;
//# sourceMappingURL=activity-control.d.ts.map