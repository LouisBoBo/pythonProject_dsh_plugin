export interface SharedMarkdownHeading {
    id: string;
    depth: number;
    text: string;
}
export interface SharedMarkdownDocument {
    html: string;
    headings: SharedMarkdownHeading[];
}
/** Render public Markdown without accepting embedded HTML or executable URLs. */
export declare function renderSharedMarkdown(markdown: string): SharedMarkdownDocument;
//# sourceMappingURL=share-markdown.d.ts.map