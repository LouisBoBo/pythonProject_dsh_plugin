import type { KnowledgeProvider } from './provider.js';
/** Host-only integration. Callers must bind operations to an explicit user-selected note. */
export declare function createNoteRecording(provider: KnowledgeProvider): {
    version: number;
    list(query: string, signal?: AbortSignal): Promise<{
        id: string;
        name: string;
    }[]>;
    read: (id: string, signal?: AbortSignal) => Promise<{
        id: string;
        name: string;
        version: number;
        content: string;
        revision: string;
    }>;
    update(id: string, value: string, expectedRevision: string, signal?: AbortSignal): Promise<{
        id: string;
        changed: boolean;
    }>;
};
//# sourceMappingURL=note-recording.d.ts.map