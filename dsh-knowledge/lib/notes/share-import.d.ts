import { lookup } from 'node:dns/promises';
import { type LookupFunction } from 'node:net';
import type { NoteNode, NoteNodeKind, NoteShare } from './domain.js';
import type { NoteStore } from './store.js';
export interface NoteShareManifestNode {
    id: string;
    path: string;
    kind: NoteNodeKind;
    mediaType: string | null;
    size: number;
    sha256: string | null;
}
export interface NoteShareManifest {
    version: 1;
    share: {
        name: string;
        kind: NoteNodeKind;
        updatedAt: string;
        nodeCount: number;
        fileCount: number;
        totalSize: number;
    };
    nodes: NoteShareManifestNode[];
    truncated: boolean;
}
export interface NoteShareImportResult {
    root: NoteNode;
    importedNodes: number;
    importedFiles: number;
    totalBytes: number;
}
export interface NoteShareRequestPolicy {
    trustedPrivateOrigins?: readonly string[];
    /** Explicit administrator approval, scoped to one canonical share, never persisted. */
    confirmedPrivateShareUrl?: string;
}
export declare function createNoteShareManifest(share: NoteShare, nodes: NoteNode[], truncated: boolean): NoteShareManifest;
export declare function inspectNoteShareUrl(rawUrl: string, store?: NoteStore, policy?: NoteShareRequestPolicy): Promise<{
    url: string;
    manifest: NoteShareManifest;
}>;
export declare function importNoteShare(store: NoteStore, rawUrl: string, parentId: string | null, policy?: NoteShareRequestPolicy): Promise<NoteShareImportResult>;
/** Keep the request on the address that passed SSRF validation, including Node 24's multi-address lookup mode. */
export declare function createPinnedLookup(target: {
    address: string;
    family: 4 | 6;
}): LookupFunction;
export declare function resolveShareTarget(url: URL, policy?: NoteShareRequestPolicy, lookupHost?: typeof lookup): Promise<{
    address: string;
    family: 4 | 6;
}>;
//# sourceMappingURL=share-import.d.ts.map