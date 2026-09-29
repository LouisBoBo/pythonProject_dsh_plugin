import type { KnowledgeProvider } from './provider.js';
import { KnowledgeNoteHandleCodec } from './note-reference-handle.js';
import type { RuntimeContextLike } from './runtime.js';
import { type KnowledgeHandleCodec } from './retrieval.js';
/** Note operations use session handles. Mounted references authorize content access; other mutations require direct user requests. */
export declare function registerKnowledgeNoteTools(ctx: RuntimeContextLike, provider: KnowledgeProvider, codec: KnowledgeNoteHandleCodec, knowledgeCodec: KnowledgeHandleCodec): void;
//# sourceMappingURL=note-tools.d.ts.map