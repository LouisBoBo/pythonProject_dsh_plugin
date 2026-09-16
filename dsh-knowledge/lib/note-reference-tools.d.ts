import type { KnowledgeProvider } from './provider.js';
import { type KnowledgeHandleCodec } from './retrieval.js';
import type { RuntimeContextLike } from './runtime.js';
import { KnowledgeNoteHandleCodec } from './note-reference-handle.js';
export declare function registerKnowledgeNoteReferenceTools(ctx: RuntimeContextLike, provider: KnowledgeProvider, knowledgeCodec: KnowledgeHandleCodec, noteCodec: KnowledgeNoteHandleCodec): void;
//# sourceMappingURL=note-reference-tools.d.ts.map