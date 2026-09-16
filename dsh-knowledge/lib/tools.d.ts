import type { KnowledgeProvider } from './provider.js';
import { KnowledgeHandleCodec } from './retrieval.js';
import type { RuntimeContextLike } from './runtime.js';
import type { KnowledgeNoteHandleCodec } from './note-reference-handle.js';
/** Register scoped retrieval tools and explicit knowledge-base management tools. */
export declare function registerKnowledgeTools(ctx: RuntimeContextLike, provider: KnowledgeProvider, codec: KnowledgeHandleCodec, noteCodec: KnowledgeNoteHandleCodec): void;
//# sourceMappingURL=tools.d.ts.map