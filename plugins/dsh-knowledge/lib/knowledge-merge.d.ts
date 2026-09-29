import type { KnowledgeTextEdit } from './domain.js';
export type RevisionResult = {
    ok: true;
    body: string;
} | {
    ok: false;
    reason: string;
};
/** Legacy/additive merge. Revisions use explicit text edits below. */
export declare function mergeKnowledgeBodies(current: string, incoming: string): string;
/**
 * Apply exact, bounded edits to a complete document.
 *
 * Exact single matches make a revision deterministic and allow the same edits
 * to be safely replayed over unrelated concurrent additions. Ambiguous or
 * missing anchors become a real review conflict instead of risking data loss.
 */
export declare function applyKnowledgeTextEdits(current: string, edits: KnowledgeTextEdit[], append?: string): RevisionResult;
//# sourceMappingURL=knowledge-merge.d.ts.map