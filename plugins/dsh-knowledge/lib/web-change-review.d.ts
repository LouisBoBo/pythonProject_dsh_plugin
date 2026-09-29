export type DiffLineKind = 'context' | 'add' | 'remove';
export interface DiffLine {
    kind: DiffLineKind;
    text: string;
    oldLine?: number;
    newLine?: number;
}
export interface LineDiff {
    lines: DiffLine[];
    additions: number;
    deletions: number;
    unchanged: number;
    simplified: boolean;
}
export type DisplayDiffLine = DiffLine | {
    kind: 'omitted';
    count: number;
};
export interface ReviewChange {
    before: string;
    after: string;
    diff: LineDiff;
    displayLines: DisplayDiffLine[];
}
/** Build the exact body preview used by candidate approval, plus a line diff. */
export declare function createReviewChange(action: 'create' | 'update' | 'conflict', currentBody: string, candidateBody: string, changeKind?: 'append' | 'revise'): ReviewChange;
/**
 * Produce a stable line diff. Large middle sections fall back to remove/add
 * blocks after common prefix and suffix trimming, bounding memory usage.
 */
export declare function createLineDiff(before: string, after: string): LineDiff;
/** Keep only nearby context, mirroring a compact source-control diff. */
export declare function compactDiffLines(lines: DiffLine[], contextSize?: number): DisplayDiffLine[];
//# sourceMappingURL=web-change-review.d.ts.map