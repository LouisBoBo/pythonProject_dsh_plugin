import { type KnowledgeMount, type KnowledgeMountDraft } from './domain.js';
import type { KnowledgeProvider } from './provider.js';
export declare const KNOWLEDGE_MOUNT_MANAGEMENT_SERVICE = "dshKnowledgeMountManagement";
export interface MountTarget {
    kind: 'project' | 'session';
    id: string;
}
/** Host-plugin integration only, not an Agent tool. Uses the active provider and
 * its remote read/write token permissions; never accesses a second data store. */
export declare function createKnowledgeMountManagement(provider: KnowledgeProvider, connectionRevision?: () => number): {
    version: 1;
    catalog(signal?: AbortSignal): Promise<{
        backend: "local" | "remote";
        bases: {
            id: string;
            name: string;
            description: string;
        }[];
    }>;
    read: (input: MountTarget[], signal?: AbortSignal) => Promise<{
        backend: "local" | "remote";
        scopes: {
            target: MountTarget;
            mounts: KnowledgeMount[];
        }[];
        revision: string;
    }>;
    configure(targets: MountTarget[], expectedRevision: string, input: Omit<KnowledgeMountDraft, "targetKind" | "targetId">, signal?: AbortSignal, beforeWrite?: () => void): Promise<{
        applied: boolean;
        backend: "local" | "remote";
        mounts: KnowledgeMount[];
    }>;
};
//# sourceMappingURL=mount-management.d.ts.map