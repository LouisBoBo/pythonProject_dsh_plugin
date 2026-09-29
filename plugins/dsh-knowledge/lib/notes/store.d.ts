import { type NoteFileUpload, type NoteListRequest, type NoteNode, type NoteShare, type NoteVersion } from './domain.js';
export declare class NoteStore {
    private readonly rootPath;
    private readonly removeOnClose;
    private readonly db;
    private readonly objectsPath;
    private readonly versionsPath;
    private readonly contentMutationTails;
    private closed;
    constructor(rootPath: string, removeOnClose?: boolean);
    list(request?: NoteListRequest): NoteNode[];
    get(id: string): NoteNode | undefined;
    subtree(id: string): NoteNode[];
    listSharedSubtree(id: string, limit?: number): NoteNode[];
    isWithin(rootId: string, candidateId: string): boolean;
    listShares(): NoteShare[];
    getShareByNoteId(noteId: string): NoteShare | undefined;
    getShareByToken(token: string): NoteShare | undefined;
    createShare(noteId: string): NoteShare;
    deleteShare(noteId: string): boolean;
    createFolder(name: string, parentId?: string | null): Promise<NoteNode>;
    createDocument(name: string, parentId?: string | null, content?: string): Promise<NoteNode>;
    upload(upload: NoteFileUpload): Promise<NoteNode>;
    read(id: string): Promise<{
        node: NoteNode;
        content: Buffer;
    }>;
    readPreview(id: string, maximumBytes: number): Promise<{
        node: NoteNode;
        content: Buffer;
        truncated: boolean;
    }>;
    readSnapshot(id: string): Promise<{
        node: NoteNode;
        content: Buffer;
    }>;
    updateContent(id: string, content: Uint8Array, expectedVersion?: number): Promise<NoteNode>;
    listVersions(id: string, limit?: number): NoteVersion[];
    readVersion(id: string, version: number): Promise<{
        node: NoteNode;
        version: NoteVersion;
        content: Buffer;
    }>;
    restoreVersion(id: string, version: number, expectedVersion?: number): Promise<NoteNode>;
    private updateContentNow;
    rename(id: string, name: string): NoteNode;
    move(id: string, parentId: string | null): NoteNode;
    copy(id: string, parentId?: string | null, requestedName?: string): Promise<NoteNode>;
    delete(id: string): Promise<void>;
    close(): Promise<void>;
    private createNode;
    private copyNode;
    private availableCopyName;
    private requireNode;
    private children;
    private assertFolder;
    private assertNameAvailable;
    private nameExists;
    private isDescendant;
    private mapShare;
    private migrate;
    private migrateVersionOne;
    private migrateVersionTwo;
    private objectPath;
    private versionDirectory;
    private versionPath;
    private enqueueContentMutation;
    private assertOpen;
}
export declare function normalizeNoteName(value: string): string;
//# sourceMappingURL=store.d.ts.map