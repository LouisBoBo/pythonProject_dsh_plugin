import type { KnowledgeBase } from '../domain.js';
import { isWindowsReplaceError, supportsDirectorySync } from '../atomic-file.js';
import { type ParsedMarkdownDocument } from './markdown.js';
export declare const KNOWLEDGE_BASE_MANIFEST = ".knowledge-base.yml";
export interface StoredKnowledgeDocument extends ParsedMarkdownDocument {
    relPath: string;
    size: number;
    modifiedAt: string;
}
/** File-system boundary for managed knowledge directories. */
export declare class KnowledgeDocumentStore {
    readonly root: string;
    private initialization;
    constructor(root: string);
    initialize(): Promise<void>;
    private initializeRoot;
    baseDirectory(base: Pick<KnowledgeBase, 'id' | 'name'>): string;
    createBase(base: KnowledgeBase): Promise<string>;
    ensureBase(base: KnowledgeBase): Promise<string>;
    updateBase(directory: string, base: KnowledgeBase): Promise<void>;
    deleteBase(directory: string): Promise<void>;
    listDocuments(directory: string): Promise<StoredKnowledgeDocument[]>;
    readDocument(directory: string, relPath: string): Promise<StoredKnowledgeDocument>;
    createDocument(directory: string, title: string, markdown: string): Promise<StoredKnowledgeDocument>;
    writeDocument(directory: string, relPath: string, markdown: string): Promise<StoredKnowledgeDocument>;
    updateDocument(directory: string, relPath: string, markdown: string, expectedContentHash?: string): Promise<StoredKnowledgeDocument>;
    deleteDocument(directory: string, relPath: string, expectedContentHash?: string): Promise<void>;
    private writeManifest;
    private assertManagedDirectory;
    private resolveDocumentPath;
    private availableDocumentPath;
}
export { isWindowsReplaceError, supportsDirectorySync };
//# sourceMappingURL=store.d.ts.map