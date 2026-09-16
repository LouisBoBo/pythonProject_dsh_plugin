export type KnowledgeColorScheme = 'light' | 'dark';
/** Canonical palette and typography for workspace, activity and shared documents. */
export declare const KNOWLEDGE_PALETTE: Record<KnowledgeColorScheme, Readonly<Record<string, string>>>;
export declare const KNOWLEDGE_FONTS: {
    '--font-ui': string;
    '--font-reading': string;
    '--font-mono': string;
};
/** One material for host-side activity and the embedded workspace panes. */
export declare const KNOWLEDGE_EMBEDDED_MATERIAL: Record<KnowledgeColorScheme, Readonly<Record<string, string>>>;
export declare function knowledgeDesignCss(scope?: string, dark?: string, systemMode?: boolean): string;
//# sourceMappingURL=design-tokens.d.ts.map