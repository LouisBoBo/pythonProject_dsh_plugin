import { type KnowledgeScope, type KnowledgeDocumentState, type KnowledgeStatus, type KnowledgeType } from '../domain.js';
export interface MarkdownDocumentMetadata {
    id: string;
    type: KnowledgeType;
    tags: string[];
    scope: KnowledgeScope;
    confidence: number;
    status: KnowledgeStatus;
    documentState: KnowledgeDocumentState;
    finalizedAt?: string;
    finalizationNote?: string;
}
export interface ParsedMarkdownDocument {
    metadata: MarkdownDocumentMetadata;
    title: string;
    body: string;
    markdown: string;
    contentHash: string;
}
/** Parse the constrained, portable front matter used by managed knowledge files. */
export declare function parseKnowledgeMarkdown(markdown: string): ParsedMarkdownDocument;
/** Render deterministic Markdown so hashes and external diffs stay stable. */
export declare function renderKnowledgeMarkdown(input: {
    metadata: MarkdownDocumentMetadata;
    title: string;
    body: string;
}): string;
export declare function renderKnowledgeBaseManifest(input: {
    id: string;
    name: string;
    group?: string;
    description: string;
    defaultTags: string[];
    extractionInstructions: string;
}): string;
export declare function markdownHash(value: string): string;
//# sourceMappingURL=markdown.d.ts.map