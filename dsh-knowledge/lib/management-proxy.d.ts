import type { KnowledgeConnectionSettings } from './connection.js';
import type { RuntimeContextLike } from './runtime.js';
export declare function registerRemoteManagementProxy(ctx: RuntimeContextLike, prefix: string, current: () => KnowledgeConnectionSettings, localService: {
    current(): {
        writebackProvider?: string;
        writebackModel?: string;
    };
    update(patch: {
        writebackProvider?: string | null;
        writebackModel?: string | null;
    }): Promise<{
        writebackProvider?: string;
        writebackModel?: string;
    }>;
}): () => void;
//# sourceMappingURL=management-proxy.d.ts.map